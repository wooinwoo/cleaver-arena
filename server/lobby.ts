import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { TABLE_GAMES, POKER_VARIANTS, type TableId, type PokerVariant } from '../shared/catalog.ts';

export type OpenRoom = {
  game: string;
  code: string;
  /** Host-chosen room name; falls back to the game name. */
  title: string;
  gameTitle: string;
  players: number;
  capacity: number;
  host: string;
  note: string;
  joinable: boolean;
};

export type RoomRegistry = { sources: Array<() => OpenRoom[]> };

type LobbyClient = { id: string; name: string; alive: boolean; count: number; window: number; created: number };

export function createRoomRegistry(): RoomRegistry {
  return { sources: [] };
}

export function registerRoomSource(registry: RoomRegistry, source: () => OpenRoom[]) {
  registry.sources.push(source);
}

export const ROOM_TITLE_MAX = 24;
/** Room names are plain text: control characters stripped, whitespace collapsed, capped. */
export function sanitizeTitle(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, ROOM_TITLE_MAX) : '';
}

export function cleaverRoom(code: string, game: { title?: string; mode: string; map: string; phase: string; players: { name: string; connected: boolean; bot?: boolean }[] }): OpenRoom {
  const humans = game.players.filter(p => !p.bot && p.connected);
  const capacity = game.mode === 'duel' ? 2 : 6;
  const mapName = game.map === 'baron' ? '바론 둥지' : game.map === 'ward' ? '원형 와드' : '장애물 경기장';
  const modeName = game.mode === 'teams' ? '팀전' : game.mode === 'duel' ? '1:1' : '개인전';
  return {
    game: 'cleaver', code, title: game.title || '문도피구', gameTitle: '문도피구',
    players: game.players.filter(p => !p.bot).length, capacity,
    host: humans[0]?.name ?? '—',
    note: `${mapName} · ${modeName}`,
    joinable: (game.phase === 'lobby' || game.phase === 'finished') && humans.length > 0,
  };
}

export function tabletopRoom(room: { code: string; kind: TableId; title?: string; variant?: string; phase: string; players: { name: string; connected: boolean }[] }): OpenRoom {
  const config = TABLE_GAMES[room.kind];
  const capacity = room.kind === 'poker'
    ? POKER_VARIANTS[(room.variant ?? 'party') as PokerVariant].max
    : config.max;
  const note = room.kind === 'poker'
    ? (room.variant === 'duel' ? '1:1 승부룰' : '파티룰')
    : room.kind === 'janggi'
      ? (room.variant === 'genius' ? '더 지니어스' : '동물장기')
      : (config.description.split(/[.!?]/)[0] ?? config.title);
  return {
    game: room.kind, code: room.code, title: room.title || config.title, gameTitle: config.title,
    players: room.players.length, capacity,
    host: room.players.find(p => p.connected)?.name ?? '—',
    note,
    // A room whose people all dropped is waiting out its reconnect window, not open to newcomers.
    joinable: room.phase !== 'playing' && room.players.some(p => p.connected),
  };
}

function openRooms(registry: RoomRegistry): OpenRoom[] {
  const rooms: OpenRoom[] = [];
  for (const source of registry.sources) {
    try { rooms.push(...source()); } catch { /* ignore broken source */ }
  }
  const seen = new Set<string>();
  return rooms.filter(room => {
    if (!room.joinable || room.players >= room.capacity) return false;
    const key = `${room.game}:${room.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
}

export function attachLobby(server: Server, registry: RoomRegistry) {
  const clients = new Map<WebSocket, LobbyClient>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  function snapshot() {
    return {
      type: 'lobby',
      members: [...clients.values()].filter(c => c.name).map(c => ({ id: c.id, name: c.name })),
      rooms: openRooms(registry),
    };
  }
  function broadcast() {
    const payload = JSON.stringify(snapshot());
    for (const ws of clients.keys()) {
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256_000) ws.send(payload);
    }
  }
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/lobby-ws') return;
    if (clients.size >= 80) { socket.destroy(); return; }
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) { socket.destroy(); return; } }
      catch { socket.destroy(); return; }
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', ws => {
    const client: LobbyClient = { id: randomUUID(), name: '', alive: true, count: 0, window: Date.now(), created: Date.now() };
    clients.set(ws, client);
    ws.send(JSON.stringify(snapshot()));
    ws.on('pong', () => { client.alive = true; });
    ws.on('error', () => ws.terminate());
    ws.on('message', raw => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - client.window > 1000) { client.count = 0; client.window = Date.now(); }
      if (++client.count > 30) { ws.close(1008); return; }
      let data: Record<string, unknown>;
      try { data = JSON.parse(raw.toString()); } catch { return; }
      if (!data || typeof data !== 'object') return;
      if (data.type === 'hello') {
        const name = typeof data.name === 'string' ? data.name.trim().replace(/[\p{C}]/gu, '').slice(0, 12) : '';
        if (!name) return;
        client.name = name;
        broadcast();
      } else if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', time: data.time }));
      } else if (data.type === 'resolve') {
        const code = String(data.code ?? '').toUpperCase();
        const found = openRooms(registry).find(room => room.code === code);
        if (!/^[A-F0-9]{6}$/.test(code)) ws.send(JSON.stringify({ type: 'error', message: '방 코드 6자리를 확인해 주세요.' }));
        else if (!found) ws.send(JSON.stringify({ type: 'error', message: '참가할 수 있는 방을 찾지 못했어요. 코드를 확인해 주세요.' }));
        else ws.send(JSON.stringify({ type: 'resolved', game: found.game, code: found.code }));
      }
    });
    ws.on('close', () => { clients.delete(ws); broadcast(); });
  });
  const heartbeat = setInterval(() => {
    for (const [ws, client] of clients) {
      if (!client.alive) ws.terminate();
      else { client.alive = false; ws.ping(); }
    }
  }, 10_000);
  const refresh = setInterval(broadcast, 2000);
  return {
    broadcast,
    close() {
      clearInterval(heartbeat); clearInterval(refresh);
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
    },
  };
}
