import type { Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  BUMPER_CAPACITY, BUMPER_INFO, addBumperPlayer, bumperView, createBumper, parseBumperInput, removeBumperPlayer,
  startBumper, tickBumper, type BumperGame,
} from '../shared/bumper.ts';
import { registerRoomSource, sanitizeTitle, type OpenRoom, type RoomRegistry } from './lobby.ts';
import { playerName, type AccountStore } from './accounts.ts';
import { sessionTokenFromRequest } from './auth.ts';

type Room = { game: BumperGame; tokens: Map<string, string>; left: Map<string, number> };
type Client = { room?: Room; id?: string; alive: boolean; count: number; window: number; created: number; lastInput: number; session: string | null };

/** Real-time bumper arena on /bumper-ws: rooms, a 30 Hz simulation and 20 Hz snapshots. */
export function attachBumper(server: Server, registry: RoomRegistry, accounts: AccountStore) {
  const rooms = new Map<string, Room>();
  const clients = new Map<WebSocket, Client>();
  registerRoomSource(registry, (): OpenRoom[] => [...rooms.values()].map(({ game }) => {
    const humans = game.players.filter(p => !p.bot && p.connected);
    return {
      game: 'bumper', code: game.code, title: game.title || BUMPER_INFO.title, gameTitle: BUMPER_INFO.title,
      players: game.players.length, capacity: BUMPER_CAPACITY, host: humans[0]?.name ?? '—', note: '실시간 밀어내기',
      joinable: (game.phase === 'lobby' || game.phase === 'finished') && humans.length > 0,
    };
  }));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const send = (ws: WebSocket, data: unknown) => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256_000) ws.send(JSON.stringify(data));
  };
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/bumper-ws') return;
    if (clients.size >= 120) { socket.destroy(); return; }
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) { socket.destroy(); return; } }
      catch { socket.destroy(); return; }
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  const host = (game: BumperGame) => game.players.find(p => !p.bot);
  const waiting = (game: BumperGame) => game.phase === 'lobby' || game.phase === 'finished';

  wss.on('connection', (ws, req) => {
    const client: Client = { alive: true, count: 0, window: Date.now(), created: Date.now(), lastInput: Date.now(), session: sessionTokenFromRequest(req) };
    clients.set(ws, client);
    ws.on('pong', () => { client.alive = true; });
    ws.on('error', () => ws.terminate());
    ws.on('message', raw => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      const fail = (message: string, type = 'error') => send(ws, { type, message });
      if (now - client.window > 1000) { client.count = 0; client.window = now; }
      if (++client.count > 90) { ws.close(1008, 'Too many messages'); return; }
      let data: Record<string, unknown>;
      try { data = JSON.parse(raw.toString()); } catch { fail('잘못된 요청이에요.'); return; }
      if (!data || typeof data !== 'object') return;
      if (data.type === 'ping') { send(ws, { type: 'pong', time: data.time }); return; }

      if (!client.room) {
        if (data.type === 'resume') {
          const room = rooms.get(String(data.code));
          const id = room?.tokens.get(String(data.token));
          const player = room?.game.players.find(p => p.id === id);
          const leftAt = player && room?.left.get(player.id);
          if (!room || !player || (leftAt !== undefined && (leftAt === 0 || now - leftAt > 20_000))) { fail('방 연결이 만료됐어요. 다시 입장해 주세요.', 'expired'); return; }
          if (player.connected) { fail('이전 연결을 정리 중이에요. 잠시 후 다시 연결해요.'); ws.close(1013); return; }
          client.room = room; client.id = id; player.connected = true; room.left.delete(player.id);
          send(ws, { type: 'joined', id, code: room.game.code, token: data.token });
          return;
        }
        if (data.type !== 'create' && data.type !== 'join') return;
        const who = playerName(accounts, client.session, data.name);
        if (!who.ok) { fail(who.message); return; }
        const name = who.name;
        let room: Room | undefined;
        if (data.type === 'create') {
          if (rooms.size >= 40) { fail('현재 방이 많아요. 잠시 후 다시 시도해 주세요.'); return; }
          let code: string;
          do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
          room = { game: createBumper(code), tokens: new Map(), left: new Map() };
          room.game.title = sanitizeTitle(data.title) || `${name}의 ${BUMPER_INFO.title}`;
          rooms.set(code, room);
        } else room = rooms.get(String(data.code).toUpperCase());
        if (!room) { fail('방을 찾을 수 없어요. 코드를 확인해 주세요.'); return; }
        if (!waiting(room.game)) { fail('경기 중인 방이에요. 경기 종료 후 입장해 주세요.'); return; }
        if (room.game.players.length >= BUMPER_CAPACITY) {
          // A waiting human takes a bot's seat rather than being turned away.
          const bot = [...room.game.players].reverse().find(p => p.bot);
          if (!bot) { fail(`방 정원 ${BUMPER_CAPACITY}명이 찼어요.`); return; }
          removeBumperPlayer(room.game, bot.id);
        }
        if (room.game.phase === 'finished') { room.game.phase = 'lobby'; room.game.winner = ''; }
        const id = randomUUID(), token = randomUUID();
        addBumperPlayer(room.game, id, name).member = who.member;
        room.tokens.set(token, id);
        client.room = room; client.id = id;
        if (data.type === 'create' && data.solo === true) for (let n = 1; n <= 3; n++) addBumperPlayer(room.game, randomUUID(), `봇 ${n}`, true);
        send(ws, { type: 'joined', id, code: room.game.code, token });
        return;
      }

      const game = client.room.game;
      const player = game.players.find(p => p.id === client.id);
      if (!player) return;
      if (data.type === 'input') {
        const input = parseBumperInput(data.input);
        if (input) { player.input = input; client.lastInput = now; }
      } else if (data.type === 'ready' && waiting(game)) {
        if (game.phase === 'finished') { game.phase = 'lobby'; game.winner = ''; }
        player.ready = !player.ready;
        startBumper(game);
      } else if (data.type === 'bot') {
        if (!waiting(game) || host(game)?.id !== player.id) { fail('방장만 경기 시작 전에 봇을 바꿀 수 있어요.'); return; }
        if (data.add === true) {
          if (game.players.length >= BUMPER_CAPACITY) { fail('자리가 없어요.'); return; }
          const used = new Set(game.players.filter(p => p.bot).map(p => p.name));
          const label = [1, 2, 3, 4, 5].map(n => `봇 ${n}`).find(candidate => !used.has(candidate)) ?? '봇';
          addBumperPlayer(game, randomUUID(), label, true);
        } else {
          const bot = [...game.players].reverse().find(p => p.bot);
          if (bot) removeBumperPlayer(game, bot.id);
        }
      } else if (data.type === 'title') {
        if (!waiting(game) || host(game)?.id !== player.id) { fail('방장만 경기 시작 전에 방 제목을 바꿀 수 있어요.'); return; }
        const title = sanitizeTitle(data.title);
        if (!title) { fail('방 제목을 입력해 주세요.'); return; }
        game.title = title;
      } else if (data.type === 'leave') {
        player.connected = false; player.ready = false; player.input = { x: 0, z: 0, dash: false };
        client.room.left.set(player.id, 0);
        client.room = undefined; client.id = undefined;
        ws.close(1000);
      }
    });
    ws.on('close', () => {
      clients.delete(ws);
      const player = client.room?.game.players.find(p => p.id === client.id);
      if (player && client.room) {
        player.connected = false; player.ready = false; player.input = { x: 0, z: 0, dash: false };
        if (!client.room.left.has(player.id)) client.room.left.set(player.id, Date.now());
      }
    });
  });

  const simulation = setInterval(() => {
    const now = Date.now();
    for (const client of clients.values()) {
      const player = client.room?.game.players.find(p => p.id === client.id);
      // A silent client stops steering instead of coasting on its last input.
      if (player && now - client.lastInput > 400) player.input = { x: 0, z: 0, dash: false };
    }
    for (const [code, room] of rooms) {
      for (const [id, at] of room.left) {
        // Leaving on purpose (0) frees the seat at once while waiting; a dropped connection gets 20 s to return.
        if (at === 0 ? !waiting(room.game) && room.game.players.some(p => p.id === id && p.alive) : now - at <= 20_000) continue;
        removeBumperPlayer(room.game, id);
        room.left.delete(id);
        for (const [token, owner] of room.tokens) if (owner === id) room.tokens.delete(token);
      }
      if (!room.game.players.some(p => !p.bot)) { rooms.delete(code); continue; }
      // Nobody human is connected mid-match: stop the match so bots do not play to an empty room.
      if (!waiting(room.game) && !room.game.players.some(p => !p.bot && p.connected)) { room.game.phase = 'lobby'; room.game.players.forEach(p => { p.ready = p.bot; }); }
      tickBumper(room.game, 1 / 30);
    }
  }, 1000 / 30);
  const broadcast = setInterval(() => {
    const views = new Map<Room, string>();
    for (const [ws, client] of clients) if (client.room) {
      let payload = views.get(client.room);
      if (!payload) { payload = JSON.stringify({ type: 'state', game: bumperView(client.room.game) }); views.set(client.room, payload); }
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256_000) ws.send(payload);
    }
  }, 50);
  const heartbeat = setInterval(() => {
    for (const [ws, client] of clients) {
      if (!client.alive || (!client.room && Date.now() - client.created > 30_000)) ws.terminate();
      else { client.alive = false; ws.ping(); }
    }
  }, 10_000);
  return {
    rooms,
    close() {
      clearInterval(simulation); clearInterval(broadcast); clearInterval(heartbeat);
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
    },
  };
}
