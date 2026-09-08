import type { Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { TABLE_GAMES, POKER_VARIANTS, isTableId, type TableId, type PokerVariant } from '../shared/catalog.ts';
import { finished, type Action, type BaseState } from '../shared/tabletop-types.ts';
import { createGomoku, actGomoku } from '../shared/gomoku.ts';
import { createQuoridor, actQuoridor } from '../shared/quoridor.ts';
import { createJanggi, actJanggi, type JanggiVariant } from '../shared/janggi.ts';
import { createPoker, actPoker, pokerView } from '../shared/poker.ts';
import { createChess, actChess } from '../shared/chess.ts';

function runtime<S extends BaseState>(state: S, act: (state: S, seat: number, action: Action) => string | null, view: (state: S, seat: number) => unknown = state => state) {
  return { state, act: (seat: number, action: Action) => act(state, seat, action), view: (seat: number) => view(state, seat) };
}
type TableVariant = JanggiVariant | PokerVariant;
const definitions = {
  chess: (_: number) => runtime(createChess(), actChess),
  gomoku: (_: number) => runtime(createGomoku(), actGomoku),
  quoridor: (_: number) => runtime(createQuoridor(), actQuoridor),
  janggi: (_: number, variant?: TableVariant) => runtime(createJanggi(variant === 'genius' ? 'genius' : 'animal'), actJanggi),
  poker: (seats: number, variant?: TableVariant) => runtime(createPoker(seats, variant === 'duel' ? 'duel' : 'party'), actPoker, pokerView),
};
type Match = ReturnType<(typeof definitions)[TableId]>;
type Member = { id: string; name: string; seat: number; ready: boolean; connected: boolean; token: string; leftAt: number };
type Room = { code: string; kind: TableId; variant?: TableVariant; phase: 'lobby' | 'playing' | 'finished'; players: Member[]; match: Match | null; round: number; result: string };
type Client = { room?: Room; member?: Member; count: number; window: number; alive: boolean; created: number };

export function attachTabletop(server: Server) {
  const rooms = new Map<string, Room>();
  const clients = new Map<WebSocket, Client>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const send = (ws: WebSocket, message: unknown) => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256_000) ws.send(JSON.stringify(message));
  };
  function broadcast(room: Room) {
    for (const [ws, client] of clients) if (client.room === room && client.member) {
      send(ws, { type: 'table-state', room: { code: room.code, kind: room.kind, variant: room.variant, phase: room.phase, round: room.round, result: room.result,
        players: room.players.map(({ id, name, seat, ready, connected }) => ({ id, name, seat, ready, connected })),
        me: client.member.seat, game: room.match?.view(client.member.seat) ?? null } });
    }
  }
  function end(room: Room) {
    room.phase = 'finished';
    room.result = room.match?.state.draw ? '무승부' : `${room.players.find(p => p.seat === room.match?.state.winner)?.name ?? '상대'} 승리`;
    room.players.forEach(p => { p.ready = false; });
  }
  function start(room: Room) {
    if (room.phase === 'playing' || room.players.length < TABLE_GAMES[room.kind].min || !room.players.every(p => p.ready && p.connected)) return;
    room.players.forEach((p, index) => { p.seat = index; });
    room.match = definitions[room.kind](room.players.length, room.variant);
    room.phase = 'playing'; room.round++; room.result = '';
  }
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/table-ws') return;
    if (clients.size >= 120) { socket.destroy(); return; }
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) { socket.destroy(); return; } }
      catch { socket.destroy(); return; }
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', ws => {
    const client: Client = { count: 0, window: Date.now(), alive: true, created: Date.now() };
    clients.set(ws, client);
    ws.on('pong', () => { client.alive = true; });
    ws.on('error', () => ws.terminate());
    ws.on('message', raw => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const fail = (message: string, type = 'error') => send(ws, { type, message });
      if (Date.now() - client.window > 1000) { client.count = 0; client.window = Date.now(); }
      if (++client.count > 30) { ws.close(1008); return; }
      let data: Record<string, unknown>;
      try { data = JSON.parse(raw.toString()); } catch { fail('요청을 읽지 못했어요.'); return; }
      if (!data || typeof data !== 'object') return;
      if (!client.room) {
        if (!isTableId(data.game)) { fail('게임을 다시 선택해 주세요.'); return; }
        if (data.type === 'resume') {
          const room = rooms.get(String(data.code));
          const member = room?.players.find(p => p.token === data.token);
          if (!room || room.kind !== data.game || !member || member.leftAt === 1 || (!member.connected && Date.now() - member.leftAt > 20_000)) { fail('방 연결이 만료됐어요. 다시 입장해 주세요.', 'expired'); return; }
          if (member.connected) {
            fail('이전 연결을 정리 중이에요. 잠시 후 다시 연결해요.');
            ws.close(1013); return;
          }
          client.room = room; client.member = member; member.connected = true; member.leftAt = 0;
          send(ws, { type: 'joined', code: room.code, token: member.token }); broadcast(room); return;
        }
        if (data.type !== 'create' && data.type !== 'join') return;
        const name = typeof data.name === 'string' ? data.name.trim().replace(/[\p{C}]/gu, '').slice(0, 12) : '';
        if (!name) { fail('닉네임을 입력해 주세요.'); return; }
        let room: Room | undefined;
        if (data.type === 'create') {
          if (data.game === 'janggi' && data.variant !== undefined && data.variant !== 'animal' && data.variant !== 'genius') { fail('십이장기 룰을 다시 선택해 주세요.'); return; }
          if (data.game === 'poker' && data.variant !== undefined && data.variant !== 'duel' && data.variant !== 'party') { fail('인디언포커 룰을 다시 선택해 주세요.'); return; }
          if (rooms.size >= 60) { fail('현재 방이 많아요. 잠시 후 다시 시도해 주세요.'); return; }
          let code: string;
          do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
          room = { code, kind: data.game, phase: 'lobby', players: [], match: null, round: 0, result: '' };
          if (room.kind === 'janggi') room.variant = data.variant === 'genius' ? 'genius' : 'animal';
          if (room.kind === 'poker') room.variant = data.variant === 'duel' ? 'duel' : 'party';
          rooms.set(code, room);
        } else room = rooms.get(String(data.code).toUpperCase());
        if (!room || room.kind !== data.game) { fail('이 게임의 방을 찾을 수 없어요. 초대 링크를 확인해 주세요.'); return; }
        if (room.phase === 'playing') { fail('경기 중이에요. 종료 후 입장할 수 있어요.'); return; }
        const capacity = room.kind === 'poker' ? POKER_VARIANTS[room.variant as PokerVariant].max : TABLE_GAMES[room.kind].max;
        if (room.players.length >= capacity) { fail('방 정원이 찼어요.'); return; }
        if (room.phase === 'finished') {
          room.phase = 'lobby'; room.match = null; room.result = '';
          room.players.forEach(p => { p.ready = false; });
        }
        const seat = [0, 1, 2, 3, 4, 5].find(n => !room!.players.some(p => p.seat === n))!;
        const member: Member = { id: randomUUID(), token: randomUUID(), name, seat, ready: false, connected: true, leftAt: 0 };
        room.players.push(member); client.room = room; client.member = member;
        send(ws, { type: 'joined', code: room.code, token: member.token }); broadcast(room); return;
      }
      const room = client.room, member = client.member!;
      if (data.type === 'ready' && room.phase !== 'playing') {
        member.ready = !member.ready;
        start(room);
        broadcast(room);
      } else if (data.type === 'action' && room.phase === 'playing' && room.match) {
        if (room.players.some(p => !p.connected)) { fail('상대의 재접속을 기다리고 있어요.'); return; }
        if (!data.action || typeof data.action !== 'object' || typeof (data.action as Action).type !== 'string') { fail('올바른 행동을 선택해 주세요.'); return; }
        const problem = room.match.act(member.seat, data.action as Action);
        if (problem) { fail(problem); return; }
        if (finished(room.match.state)) end(room);
        broadcast(room);
      } else if (data.type === 'leave') {
        member.connected = false; member.ready = false; member.leftAt = 1;
        client.room = undefined; client.member = undefined;
        ws.close(1000); broadcast(room);
      }
    });
    ws.on('close', () => {
      clients.delete(ws);
      if (client.member && client.room) {
        client.member.connected = false; client.member.ready = false;
        client.member.leftAt ||= Date.now();
        broadcast(client.room);
      }
    });
  });
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const expired = room.players.filter(p => !p.connected && now - p.leftAt > 20_000);
      if (!expired.length) continue;
      if (room.phase === 'playing' && room.match) {
        const connected = room.players.filter(p => p.connected);
        if (room.kind === 'poker' && room.variant === 'party') room.match = definitions.poker(room.players.length, 'party');
        if (room.match.state.kind === 'poker' && room.variant === 'duel' && connected.length === 1) {
          const state = room.match.state, winner = connected[0].seat;
          const total = state.chips.reduce((sum, chips) => sum + chips, state.pot);
          state.chips = state.chips.map((_, seat) => seat === winner ? total : 0);
          state.pot = 0; state.stage = 'reveal'; state.handWinner = winner;
          state.log = '상대가 퇴장해 남은 칩을 모두 가져가요.';
        }
        room.match.state.winner = connected.length === 1 ? connected[0].seat : null;
        room.match.state.draw = connected.length !== 1;
        end(room);
        room.result = room.kind === 'poker' && room.variant === 'party' ? '접속 종료로 이번 판 취소 · 칩 초기화' : room.result;
      }
      room.players = room.players.filter(p => !expired.includes(p));
      if (!room.players.length) rooms.delete(code);
      else { start(room); broadcast(room); }
    }
  }, 1000);
  const heartbeat = setInterval(() => {
    for (const [ws, client] of clients) {
      if (!client.alive || (!client.room && Date.now() - client.created > 30_000)) ws.terminate();
      else { client.alive = false; ws.ping(); }
    }
  }, 10_000);
  return () => {
    clearInterval(cleanup); clearInterval(heartbeat);
    for (const ws of clients.keys()) ws.terminate();
    wss.close();
  };
}
