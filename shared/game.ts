export const HALF_X = 12;
export const HALF_Z = 9;
export const SPEED = 5.5;
export const RADIUS = 0.5;
export const COOLDOWN = 0.65;
export const OBSTACLES = [
  { x: -4.5, z: -2.8, radius: 1 }, { x: 4.5, z: 2.8, radius: 1 },
  { x: -4.5, z: 2.8, radius: 1 }, { x: 4.5, z: -2.8, radius: 1 },
];

export type Input = { x: number; z: number; yaw: number; fire: boolean };
export type Player = {
  id: string; name: string; slot: number; team: number;
  x: number; z: number; yaw: number; hp: number; cooldown: number;
  ready: boolean; connected: boolean; bot: boolean; input: Input;
};
export type Shot = { id: number; owner: string; team: number; x: number; z: number; vx: number; vz: number };
export type Game = {
  code: string; mode: 'ffa' | 'teams'; phase: 'lobby' | 'countdown' | 'playing' | 'finished';
  players: Player[]; shots: Shot[]; time: number; countdown: number;
  winner: string; nextShot: number; round: number;
};

export function createGame(code: string, mode: Game['mode'] = 'ffa'): Game {
  return { code, mode, phase: 'lobby', players: [], shots: [], time: 120, countdown: 3, winner: '', nextShot: 0, round: 0 };
}

export function addPlayer(game: Game, id: string, name: string, bot = false): Player {
  const slot = [0, 1, 2, 3, 4, 5].find(n => !game.players.some(p => p.slot === n));
  if (slot === undefined) throw new Error('방 정원이 찼어요.');
  const player: Player = {
    id, name, slot, team: slot % 2, x: 0, z: 0, yaw: 0, hp: 100,
    cooldown: 0, ready: bot, connected: true, bot, input: { x: 0, z: 0, yaw: 0, fire: false },
  };
  game.players.push(player);
  spawn(player);
  return player;
}

function spawn(player: Player) {
  const angle = Math.PI * 2 * player.slot / 6;
  player.x = Math.cos(angle) * 8;
  player.z = Math.sin(angle) * 6;
  player.yaw = Math.atan2(-player.x, -player.z);
  player.input = { x: 0, z: 0, yaw: player.yaw, fire: false };
  player.hp = 100;
  player.cooldown = 0;
}

export function startRound(game: Game): boolean {
  if (!['lobby', 'finished'].includes(game.phase) || game.players.length < 2 ||
      game.players.some(p => !p.ready || !p.connected)) return false;
  if (game.mode === 'teams' && game.players.length % 2 !== 0) return false;
  game.players.forEach((player, index) => { player.team = index % 2; spawn(player); });
  game.shots = [];
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
  const length = Math.max(1, Math.hypot(v.x as number, v.z as number));
  return { x: (v.x as number) / length, z: (v.z as number) / length,
    yaw: (v.yaw as number) % (Math.PI * 2), fire: v.fire };
}

export function move(player: { x: number; z: number }, x: number, z: number, dt: number) {
  player.x = Math.max(-HALF_X + RADIUS, Math.min(HALF_X - RADIUS, player.x + x * SPEED * dt));
  player.z = Math.max(-HALF_Z + RADIUS, Math.min(HALF_Z - RADIUS, player.z + z * SPEED * dt));
  for (const obstacle of OBSTACLES) {
    const dx = player.x - obstacle.x, dz = player.z - obstacle.z;
    const distance = Math.hypot(dx, dz), limit = RADIUS + obstacle.radius;
    if (distance < limit) {
      player.x = obstacle.x + (distance ? dx / distance : 1) * limit;
      player.z = obstacle.z + (distance ? dz / distance : 0) * limit;
    }
  }
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

export function tick(game: Game, dt: number) {
  if (game.phase === 'countdown') {
    game.countdown -= dt;
    if (game.countdown <= 0) game.phase = 'playing';
    return;
  }
  if (game.phase !== 'playing') return;
  game.time = Math.max(0, game.time - dt);
  for (const player of game.players) {
    if (!player.connected || player.hp <= 0) continue;
    if (player.bot) {
      const enemy = game.players.find(p => p.connected && p.id !== player.id && p.hp > 0 && (game.mode === 'ffa' || p.team !== player.team));
      if (enemy) player.input = { x: Math.cos(game.time * 1.2) * 0.5, z: Math.sin(game.time * 0.8) * 0.5,
        yaw: Math.atan2(enemy.x - player.x, enemy.z - player.z) + Math.sin(game.time * 2) * 0.18, fire: true };
    }
    move(player, player.input.x, player.input.z, dt);
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
    if (Math.abs(oldX) > HALF_X || Math.abs(oldZ) > HALF_Z) return false;
    shot.x += shot.vx * dt;
    shot.z += shot.vz * dt;
    const dx = shot.x - oldX, dz = shot.z - oldZ;
    let first = Math.min(
      dx ? (Math.sign(dx) * HALF_X - oldX) / dx : Infinity,
      dz ? (Math.sign(dz) * HALF_Z - oldZ) / dz : Infinity,
      ...OBSTACLES.map(o => hitTime(o.x, o.z, oldX, oldZ, shot.x, shot.z, o.radius + .15)),
    );
    let target: Player | undefined;
    for (const player of game.players) {
      if (!player.connected || player.hp <= 0 || player.id === shot.owner || (game.mode === 'teams' && player.team === shot.team)) continue;
      const time = hitTime(player.x, player.z, oldX, oldZ, shot.x, shot.z, RADIUS + .15);
      if (time < first) { first = time; target = player; }
    }
    if (!target) return first > 1;
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
