export const ARENA_RADIUS = 10;
export type ArenaMap = 'ward' | 'arena' | 'baron';
export const HALF_X = 12;
export const HALF_Z = 9;
export const SPEED = 5.5;
export const RADIUS = 0.5;
export const AVATAR_SCALE = 1.5;
// Posed shoulders span about 1.5 model units at cleaver height; movement has its own radius.
export const HIT_RADIUS = .75 * AVATAR_SCALE;
export const COOLDOWN = 0.65;
export const FLASH_COOLDOWN = 20;
export const GHOST_COOLDOWN = 30;
export const FLASH_DISTANCE = 4;
export const GHOST_DURATION = 6;
export const GHOST_MULTIPLIER = 1.4;
export const OBSTACLES = [
  { x: -4.5, z: -2.8, radius: 1 }, { x: 4.5, z: 2.8, radius: 1 },
  { x: -4.5, z: 2.8, radius: 1 }, { x: 4.5, z: -2.8, radius: 1 },
];

export type Input = { x: number; z: number; yaw: number; fire: boolean; target?: { x: number; z: number } };
export type Player = {
  id: string; name: string; slot: number; team: number;
  x: number; z: number; yaw: number; hp: number; cooldown: number;
  flashCooldown: number; ghostCooldown: number; ghostTime: number; flashes: number;
  ready: boolean; connected: boolean; bot: boolean; input: Input;
};
export type Shot = { id: number; owner: string; team: number; x: number; z: number; vx: number; vz: number };
export type Hit = { owner: string; target: string; x: number; z: number; damage: number };
export type Game = {
  code: string; map: ArenaMap; mode: 'duel' | 'ffa' | 'teams'; phase: 'lobby' | 'countdown' | 'playing' | 'finished';
  view: 'top' | 'fps'; spellCooldowns: { flash: number; ghost: number };
  players: Player[]; shots: Shot[]; hits: Hit[]; time: number; countdown: number;
  winner: string; nextShot: number; round: number;
};

export function createGame(code: string, mode: Game['mode'] = 'duel', map: ArenaMap = 'ward', view: Game['view'] = 'top'): Game {
  return { code, map, view, spellCooldowns: { flash: FLASH_COOLDOWN, ghost: GHOST_COOLDOWN },
    mode: map !== 'arena' && mode === 'ffa' ? 'duel' : mode, phase: 'lobby', players: [], shots: [], hits: [], time: 120, countdown: 3, winner: '', nextShot: 0, round: 0 };
}

export function addPlayer(game: Game, id: string, name: string, bot = false): Player {
  const slot = Array.from({ length: game.mode === 'duel' ? 2 : 6 }, (_, n) => n).find(n => !game.players.some(p => p.slot === n));
  if (slot === undefined) throw new Error('방 정원이 찼어요.');
  const player: Player = {
    id, name, slot, team: slot % 2, x: 0, z: 0, yaw: 0, hp: 100,
    cooldown: 0, flashCooldown: 0, ghostCooldown: 0, ghostTime: 0, flashes: 0,
    ready: bot, connected: true, bot, input: { x: 0, z: 0, yaw: 0, fire: false },
  };
  game.players.push(player);
  spawn(player, game.map);
  return player;
}

function spawn(player: Player, map: ArenaMap, lane = Math.floor(player.slot / 2)) {
  player.x = player.team === 0 ? -5 : 5;
  player.z = [0, -3, 3][lane];
  player.yaw = player.team === 0 ? Math.PI / 2 : -Math.PI / 2;
  if (map === 'arena') {
    const angle = Math.PI * 2 * player.slot / 6;
    player.x = Math.cos(angle) * 8; player.z = Math.sin(angle) * 6;
    player.yaw = Math.atan2(-player.x, -player.z);
  }
  player.input = { x: 0, z: 0, yaw: player.yaw, fire: false };
  player.hp = 100;
  player.cooldown = 0;
  player.flashCooldown = 0; player.ghostCooldown = 0; player.ghostTime = 0; player.flashes = 0;
}

export function startRound(game: Game): boolean {
  if (!['lobby', 'finished'].includes(game.phase) || game.players.length < 2 ||
      game.players.some(p => !p.ready || !p.connected)) return false;
  if (game.mode === 'teams' && game.players.length % 2 !== 0) return false;
  game.players.forEach((player, index) => { player.team = index % 2; spawn(player, game.map, Math.floor(index / 2)); });
  game.shots = [];
  game.hits = [];
  game.phase = 'countdown';
  game.countdown = 3;
  game.time = 120;
  game.winner = '';
  game.round++;
  return true;
}

export function parseInput(value: unknown): Input | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (![v.x, v.z, v.yaw].every(n => typeof n === 'number' && Number.isFinite(n)) || typeof v.fire !== 'boolean') return null;
  let target: Input['target'];
  if (v.target !== undefined) {
    if (!v.target || typeof v.target !== 'object') return null;
    const point = v.target as Record<string, unknown>;
    if (![point.x, point.z].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1000)) return null;
    target = { x: point.x as number, z: point.z as number };
  }
  const length = Math.max(1, Math.hypot(v.x as number, v.z as number));
  return { x: (v.x as number) / length, z: (v.z as number) / length,
    yaw: (v.yaw as number) % (Math.PI * 2), fire: v.fire, ...(target ? { target } : {}) };
}

export function moveInput(player: { x: number; z: number }, input: Input, dt: number, team: number, map: ArenaMap, multiplier = 1) {
  let { x, z } = input;
  if (input.target) {
    const dx = input.target.x - player.x, dz = input.target.z - player.z;
    const distance = Math.max(Math.hypot(dx, dz), SPEED * dt * multiplier, .0001);
    x = dx / distance; z = dz / distance;
  }
  move(player, x, z, dt, team, map, multiplier);
}

export function move(player: { x: number; z: number }, x: number, z: number, dt: number, team: number, map: ArenaMap, multiplier = 1) {
  const distanceMoved = SPEED * dt * multiplier;
  if (map === 'arena') {
    player.x = Math.max(-HALF_X + RADIUS, Math.min(HALF_X - RADIUS, player.x + x * distanceMoved));
    player.z = Math.max(-HALF_Z + RADIUS, Math.min(HALF_Z - RADIUS, player.z + z * distanceMoved));
    for (const obstacle of OBSTACLES) {
      const dx = player.x - obstacle.x, dz = player.z - obstacle.z;
      const distance = Math.hypot(dx, dz), limit = RADIUS + obstacle.radius;
      if (distance < limit) {
        player.x = obstacle.x + (distance ? dx / distance : 1) * limit;
        player.z = obstacle.z + (distance ? dz / distance : 0) * limit;
      }
    }
    return;
  }
  const side = team === 0 ? -1 : 1, limit = ARENA_RADIUS - RADIUS;
  player.x = side * Math.max(RADIUS, side * (player.x + x * distanceMoved));
  player.z += z * distanceMoved;
  const distance = Math.hypot(player.x, player.z);
  if (distance > limit) { player.x *= limit / distance; player.z *= limit / distance; }
  player.x = side * Math.max(RADIUS, side * player.x);
  const maxZ = Math.sqrt(Math.max(0, limit * limit - player.x * player.x));
  player.z = Math.max(-maxZ, Math.min(maxZ, player.z));
}

function hitTime(x: number, z: number, ax: number, az: number, bx: number, bz: number, radius: number) {
  const dx = bx - ax, dz = bz - az;
  const mx = ax - x, mz = az - z, c = mx * mx + mz * mz - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz, b = mx * dx + mz * dz;
  const discriminant = b * b - a * c;
  if (a === 0 || discriminant < 0) return Infinity;
  const time = (-b - Math.sqrt(discriminant)) / a;
  return time >= 0 && time <= 1 ? time : Infinity;
}

export function castSpell(game: Game, id: string, spell: unknown, yaw: unknown): string | null {
  if (spell !== 'flash' && spell !== 'ghost') return '점멸 또는 유체화를 선택해 주세요.';
  if (typeof yaw !== 'number' || !Number.isFinite(yaw)) return '올바른 방향을 보내 주세요.';
  if (game.phase !== 'playing') return '경기가 시작된 뒤 사용할 수 있어요.';
  const player = game.players.find(candidate => candidate.id === id);
  if (!player || !player.connected || player.hp <= 0) return '접속 중인 살아 있는 플레이어만 사용할 수 있어요.';
  if ((spell === 'flash' ? player.flashCooldown : player.ghostCooldown) > 0) return '아직 재사용 대기 중이에요.';
  if (spell === 'ghost') {
    player.ghostTime = GHOST_DURATION;
    player.ghostCooldown = game.spellCooldowns.ghost;
  } else {
    const target = { x: player.x + Math.sin(yaw) * FLASH_DISTANCE, z: player.z + Math.cos(yaw) * FLASH_DISTANCE };
    if (game.map === 'arena') for (const obstacle of OBSTACLES) {
      const radius = obstacle.radius + RADIUS;
      if (Math.hypot(target.x - obstacle.x, target.z - obstacle.z) < radius) {
        // Landing inside an obstacle stops at its near edge; jumping over one remains allowed.
        const fraction = hitTime(obstacle.x, obstacle.z, player.x, player.z, target.x, target.z, radius);
        target.x = player.x + (target.x - player.x) * fraction;
        target.z = player.z + (target.z - player.z) * fraction;
      }
    }
    move(target, 0, 0, 0, player.team, game.map);
    player.x = target.x; player.z = target.z;
    delete player.input.target;
    player.yaw = yaw % (Math.PI * 2); player.input.yaw = player.yaw;
    player.flashCooldown = game.spellCooldowns.flash;
    player.flashes++;
  }
  return null;
}

export function tick(game: Game, dt: number) {
  if (game.phase === 'countdown') {
    game.countdown -= dt;
    if (game.countdown <= 0) game.phase = 'playing';
    return;
  }
  if (game.phase !== 'playing') return;
  game.time = Math.max(0, game.time - dt);
  for (const player of game.players) {
    const boostedTime = Math.min(dt, player.ghostTime);
    player.flashCooldown = Math.max(0, player.flashCooldown - dt);
    player.ghostCooldown = Math.max(0, player.ghostCooldown - dt);
    player.ghostTime = Math.max(0, player.ghostTime - dt);
    if (!player.connected || player.hp <= 0) continue;
    if (player.bot) {
      const enemy = game.players.find(p => p.connected && p.hp > 0 && p.id !== player.id && (game.mode === 'ffa' || p.team !== player.team));
      if (enemy) player.input = { x: Math.cos(game.time * 1.2) * 0.5, z: Math.sin(game.time * 0.8) * 0.5,
        yaw: Math.atan2(enemy.x - player.x, enemy.z - player.z) + Math.sin(game.time * 2) * 0.18, fire: true };
    }
    if (boostedTime > 0) moveInput(player, player.input, boostedTime, player.team, game.map, GHOST_MULTIPLIER);
    if (dt > boostedTime) moveInput(player, player.input, dt - boostedTime, player.team, game.map);
    player.yaw = player.input.yaw;
    player.cooldown = Math.max(0, player.cooldown - dt);
    if (player.input.fire && player.cooldown <= 0) {
      const vx = Math.sin(player.yaw), vz = Math.cos(player.yaw);
      game.shots.push({ id: game.nextShot++, owner: player.id, team: player.team, x: player.x + vx * 0.6,
        z: player.z + vz * 0.6, vx: vx * 15, vz: vz * 15 });
      player.cooldown = player.bot ? 1.3 : COOLDOWN;
    }
  }
  game.shots = game.shots.filter(shot => {
    const oldX = shot.x, oldZ = shot.z;
    if (game.map !== 'arena' ? Math.hypot(oldX, oldZ) > ARENA_RADIUS : Math.abs(oldX) > HALF_X || Math.abs(oldZ) > HALF_Z) return false;
    shot.x += shot.vx * dt;
    shot.z += shot.vz * dt;
    const dx = shot.x - oldX, dz = shot.z - oldZ;
    const a = dx * dx + dz * dz, b = oldX * dx + oldZ * dz;
    const c = oldX * oldX + oldZ * oldZ - ARENA_RADIUS * ARENA_RADIUS;
    let first = a ? (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a : Infinity;
    if (game.map === 'arena') first = Math.min(
      dx ? (Math.sign(dx) * HALF_X - oldX) / dx : Infinity,
      dz ? (Math.sign(dz) * HALF_Z - oldZ) / dz : Infinity,
      ...OBSTACLES.map(o => hitTime(o.x, o.z, oldX, oldZ, shot.x, shot.z, o.radius + .15)),
    );
    let target: Player | undefined;
    for (const player of game.players) {
      if (!player.connected || player.hp <= 0 || player.id === shot.owner || (game.mode !== 'ffa' && player.team === shot.team)) continue;
      const time = hitTime(player.x, player.z, oldX, oldZ, shot.x, shot.z, HIT_RADIUS + .15);
      if (time < first) { first = time; target = player; }
    }
    if (!target) return first > 1;
    // Retain hits between broadcasts. A round has at most six players × four hits.
    game.hits.push({ owner: shot.owner, target: target.id, x: target.x, z: target.z, damage: Math.min(25, target.hp) });
    target.hp = Math.max(0, target.hp - 25);
    return false;
  });
  const alive = game.players.filter(p => p.hp > 0 && p.connected);
  const sides = new Set(alive.map(p => game.mode === 'teams' ? p.team : p.id));
  if (sides.size <= 1 || game.time <= 0) {
    game.phase = 'finished';
    game.winner = sides.size === 1 ? (game.mode === 'teams' ? `${alive[0].team === 0 ? '민트' : '코랄'} 팀 승리` : `${alive[0].name} 승리`) : '무승부';
    game.players.forEach(p => { p.ready = p.bot; p.input.fire = false; });
    game.shots = [];
  }
}
