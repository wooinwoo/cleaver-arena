import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { addPlayer, createGame, parseInput, startRound, tick, type Game } from '../shared/game.ts';
import { attachTabletop } from './tabletop.ts';

type Room = { game: Game; tokens: Map<string, string>; disconnected: Map<string, number> };
type Client = { room?: Room; id?: string; alive: boolean; count: number; window: number; lastInput: number; created: number };
const publicDir = fileURLToPath(new URL('../dist/', import.meta.url));
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

export function createArenaServer() {
  // ponytail: Rooms live in one process. Add shared state and room routing only when scaling beyond one server.
  const rooms = new Map<string, Room>();
  const clients = new Map<WebSocket, Client>();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    let pathname: string;
    try { pathname = new URL(req.url ?? '/', 'http://local').pathname; }
    catch { res.writeHead(400).end(); return; }
    if (pathname === '/health') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); return; }
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); } catch { res.writeHead(400).end(); return; }
    const path = resolve(publicDir, '.' + (decoded === '/' ? '/index.html' : decoded));
    if (!path.startsWith(publicDir) || !mime[extname(path)]) { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(path);
      res.setHeader('Content-Type', `${mime[extname(path)]}; charset=utf-8`);
      res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404).end('게임을 먼저 빌드해 주세요.'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const closeTables = attachTabletop(server);
  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/table-ws') return;
    if (req.url !== '/ws' || clients.size >= 120) { socket.destroy(); return; }
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) { socket.destroy(); return; } }
      catch { socket.destroy(); return; }
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  const send = (ws: WebSocket, data: unknown) => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256_000) ws.send(JSON.stringify(data));
  };
  wss.on('connection', ws => {
    const client: Client = { alive: true, count: 0, window: Date.now(), lastInput: Date.now(), created: Date.now() };
    clients.set(ws, client);
    ws.on('pong', () => { client.alive = true; });
    ws.on('message', raw => {
      const now = Date.now();
      if (now - client.window > 1000) { client.count = 0; client.window = now; }
      if (++client.count > 90) { ws.close(1008, 'Too many messages'); return; }
      let data: Record<string, unknown>;
      try { data = JSON.parse(raw.toString()); } catch { send(ws, { type: 'error', message: '잘못된 요청이에요.' }); return; }
      if (!data || typeof data !== 'object') return;
      if (data.type === 'ping') { send(ws, { type: 'pong', time: data.time }); return; }
      if (!client.room) {
        if (!['create', 'join', 'resume'].includes(String(data.type))) return;
        if (data.type === 'resume') {
          const room = rooms.get(String(data.code));
          const id = room?.tokens.get(String(data.token));
          const player = room?.game.players.find(p => p.id === id);
          if (!room || !player || player.connected) { send(ws, { type: 'expired', message: '방 연결이 만료됐어요. 다시 입장해 주세요.' }); return; }
          client.room = room; client.id = id;
          player.connected = true;
          room.disconnected.delete(player.id);
          send(ws, { type: 'joined', id, code: room.game.code, token: data.token });
          return;
        }
        const name = typeof data.name === 'string' ? data.name.trim().replace(/[\p{C}]/gu, '').slice(0, 12) : '';
        if (!name) { send(ws, { type: 'error', message: '닉네임을 입력해 주세요.' }); return; }
        let room: Room | undefined;
        if (data.type === 'create') {
          if (rooms.size >= 60) { send(ws, { type: 'error', message: '현재 방이 많아요. 잠시 후 다시 시도해 주세요.' }); return; }
          let code: string;
          do { code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(code));
          room = { game: createGame(code, data.mode === 'teams' ? 'teams' : 'ffa'), tokens: new Map(), disconnected: new Map() };
          rooms.set(code, room);
        } else room = rooms.get(String(data.code).toUpperCase());
        if (!room) { send(ws, { type: 'error', message: '방을 찾을 수 없어요. 코드를 확인해 주세요.' }); return; }
        if (room.game.phase !== 'lobby' && room.game.phase !== 'finished') { send(ws, { type: 'error', message: '경기 중인 방이에요. 경기 종료 후 입장해 주세요.' }); return; }
        if (room.game.players.length >= 6) { send(ws, { type: 'error', message: '방 정원 6명이 찼어요.' }); return; }
        const id = randomUUID(), token = randomUUID();
        addPlayer(room.game, id, name);
        room.tokens.set(token, id);
        client.room = room; client.id = id;
        if (data.type === 'create' && data.practice === true) addPlayer(room.game, randomUUID(), '연습 로봇', true);
        send(ws, { type: 'joined', id, code: room.game.code, token });
        return;
      }
      const game = client.room.game;
      const player = game.players.find(p => p.id === client.id);
      if (!player) return;
      if (data.type === 'input') {
        const input = parseInput(data.input);
        if (input) { player.input = input; client.lastInput = now; }
      } else if (data.type === 'ready' && (game.phase === 'lobby' || game.phase === 'finished')) {
        player.ready = !player.ready;
        startRound(game);
      } else if (data.type === 'leave') {
        client.room.disconnected.set(player.id, 0);
        ws.close(1000);
      }
    });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      clients.delete(ws);
      const player = client.room?.game.players.find(p => p.id === client.id);
      if (player && client.room) {
        player.connected = false;
        player.ready = false;
        player.input = { x: 0, z: 0, yaw: player.yaw, fire: false };
        if (!client.room.disconnected.has(player.id)) client.room.disconnected.set(player.id, Date.now());
      }
    });
  });
  const simulation = setInterval(() => {
    const now = Date.now();
    for (const client of clients.values()) {
      if (client.room && now - client.lastInput > 250) {
        const player = client.room.game.players.find(p => p.id === client.id);
        if (player) player.input = { x: 0, z: 0, yaw: player.yaw, fire: false };
      }
    }
    for (const [code, room] of rooms) {
      if (room.game.phase === 'countdown' && (room.disconnected.size > 0 || room.game.players.some(p => !p.connected))) {
        room.game.phase = 'lobby'; room.game.players.forEach(p => { p.ready = p.bot; });
      }
      for (const [id, at] of room.disconnected) if (now - at > 20_000) {
        room.game.players = room.game.players.filter(p => p.id !== id);
        room.disconnected.delete(id);
        for (const [token, owner] of room.tokens) if (owner === id) room.tokens.delete(token);
      }
      if (room.game.players.every(p => p.bot)) { rooms.delete(code); continue; }
      tick(room.game, 1 / 30);
    }
  }, 1000 / 30);
  const broadcast = setInterval(() => {
    for (const [ws, client] of clients) if (client.room) send(ws, { type: 'state', game: client.room.game });
  }, 50);
  const heartbeat = setInterval(() => {
    for (const [ws, client] of clients) {
      if (!client.alive || (!client.room && Date.now() - client.created > 30_000)) ws.terminate();
      else { client.alive = false; ws.ping(); }
    }
  }, 10_000);
  return {
    server, rooms,
    async close() {
      clearInterval(simulation); clearInterval(broadcast); clearInterval(heartbeat);
      closeTables();
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
      await new Promise<void>(done => server.close(() => done()));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arena = createArenaServer();
  const port = Number(process.env.PORT || 3186);
  arena.server.listen(port, '0.0.0.0', () => console.log(`Cleaver Club listening on ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void arena.close().then(() => process.exit(0)); });
}
