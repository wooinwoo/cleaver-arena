/**
 * 범퍼카: a real-time knock-out arena. The server owns this simulation (30 ticks/s);
 * clients only send steering and render interpolated snapshots.
 */
export const BUMPER_INFO = {
  title: '범퍼카',
  min: 1,
  max: 6,
  description: '3D 경기장에서 서로 밀어 떨어뜨리는 실시간 대전.',
  rules: '원형 경기장 위에서 차를 몰아 상대를 밖으로 밀어내요. 경기장 밖으로 떨어지면 그 라운드에서 탈락해요. 대시를 쓰면 순간적으로 빨라지고, 대시 중에 부딪히면 상대가 더 멀리 튕겨요. 대시는 다시 쓸 수 있을 때까지 잠시 기다려야 해요. 라운드가 시작되고 10초가 지나면 경기장이 점점 줄어들어요. 60초가 지나면 경기장이 빠르게 사라져요. 마지막까지 남은 한 명이 라운드를 가져가고, 3라운드를 먼저 이기면 우승이에요. PC는 WASD 또는 방향키로 이동하고 Space로 대시해요. 모바일은 왼쪽 패드로 이동하고 오른쪽 버튼으로 대시해요.',
} as const;

export const ARENA_START = 12, ARENA_MIN = 4.5, SHRINK_AFTER = 10, SHRINK_PER_SEC = .3, SUDDEN_SHRINK = 1.5;
export const CAR_RADIUS = .95, ACCEL = 30, MAX_SPEED = 9, DRAG = 2.2;
export const DASH_SPEED = 16, DASH_TIME = .25, DASH_COOLDOWN = 2.2, STUN_TIME = .45;
export const ROUND_SECONDS = 60, TARGET_WINS = 3, COUNTDOWN = 3, INTERMISSION = 2.6, KO_CREDIT = 4;
export const BUMPER_CAPACITY = 6;

export interface BumperInput { x: number; z: number; dash: boolean }
export interface BumperPlayer {
  id: string; name: string; slot: number; bot: boolean; connected: boolean; ready: boolean;
  x: number; z: number; vx: number; vz: number; yaw: number;
  alive: boolean; fall: number; dashCooldown: number; dashTime: number; stun: number;
  score: number; kos: number; lastHitBy: string | null; lastHitAge: number;
  input: BumperInput;
  /** Playing under a logged-in account. The server sets this; it is false for guests and bots. */
  member: boolean;
}
export type BumperEvent = { seq: number; type: 'hit' | 'fall' | 'dash'; x: number; z: number; a: number; b: number; power: number };
export type BumperPhase = 'lobby' | 'countdown' | 'playing' | 'roundEnd' | 'finished';
export interface BumperGame {
  code: string; title: string; phase: BumperPhase; players: BumperPlayer[];
  radius: number; time: number; countdown: number; pause: number; round: number; target: number;
  /** Player id that took the last round, or null for a draw. */
  roundWinner: string | null;
  /** Match result text once finished. */
  winner: string;
  events: BumperEvent[]; seq: number;
}

export function createBumper(code: string): BumperGame {
  return { code, title: '', phase: 'lobby', players: [], radius: ARENA_START, time: ROUND_SECONDS, countdown: 0, pause: 0, round: 0, target: TARGET_WINS, roundWinner: null, winner: '', events: [], seq: 0 };
}

export function addBumperPlayer(game: BumperGame, id: string, name: string, bot = false): BumperPlayer {
  const slot = [0, 1, 2, 3, 4, 5].find(n => !game.players.some(p => p.slot === n)) ?? game.players.length;
  const player: BumperPlayer = {
    id, name, slot, bot, connected: true, ready: bot, x: 0, z: 0, vx: 0, vz: 0, yaw: 0,
    alive: true, fall: 0, dashCooldown: 0, dashTime: 0, stun: 0, score: 0, kos: 0, lastHitBy: null, lastHitAge: 99,
    input: { x: 0, z: 0, dash: false }, member: false,
  };
  game.players.push(player);
  place(game);
  return player;
}

export function removeBumperPlayer(game: BumperGame, id: string) {
  game.players = game.players.filter(p => p.id !== id);
  if (game.phase === 'lobby' || game.phase === 'finished') place(game);
}

/** Parks everyone on a ring facing the centre: the lobby line-up and each round's start. */
function place(game: BumperGame) {
  const count = Math.max(1, game.players.length);
  const ring = Math.min(ARENA_START * .62, 3 + count * 1.1);
  [...game.players].sort((a, b) => a.slot - b.slot).forEach((player, index) => {
    const angle = Math.PI / 2 + index / count * Math.PI * 2;
    player.x = Math.cos(angle) * ring; player.z = Math.sin(angle) * ring;
    player.vx = 0; player.vz = 0; player.yaw = Math.atan2(-player.x, -player.z);
    player.alive = true; player.fall = 0; player.dashCooldown = 0; player.dashTime = 0; player.stun = 0;
    player.lastHitBy = null; player.lastHitAge = 99;
  });
}

/** Starts a match when every connected human is ready and at least two cars are on the floor. */
export function startBumper(game: BumperGame): boolean {
  if (game.phase !== 'lobby' && game.phase !== 'finished') return false;
  const humans = game.players.filter(p => !p.bot);
  if (game.players.length < 2 || !humans.length || !humans.every(p => p.ready && p.connected)) return false;
  for (const player of game.players) { player.score = 0; player.kos = 0; }
  game.round = 0; game.winner = ''; game.events = [];
  beginRound(game);
  return true;
}

function beginRound(game: BumperGame) {
  game.round++; game.radius = ARENA_START; game.time = ROUND_SECONDS; game.roundWinner = null;
  place(game);
  game.countdown = COUNTDOWN; game.phase = 'countdown';
}

export function parseBumperInput(value: unknown): BumperInput | null {
  if (!value || typeof value !== 'object') return null;
  const { x, z, dash } = value as Record<string, unknown>;
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x: Math.max(-1, Math.min(1, x)), z: Math.max(-1, Math.min(1, z)), dash: dash === true };
}

function emit(game: BumperGame, event: Omit<BumperEvent, 'seq'>) {
  game.events.push({ ...event, seq: ++game.seq });
  if (game.events.length > 12) game.events.shift();
}

/**
 * Bot steering: stay off the rim first, then get on the centre side of the nearest rival
 * and ram them outward, dashing when lined up.
 */
export function bumperBot(game: BumperGame, me: BumperPlayer, random: () => number = Math.random): BumperInput {
  const distance = Math.hypot(me.x, me.z);
  // Where this car will be in half a second: brake before the rim, not on it.
  const aheadX = me.x + me.vx * .5, aheadZ = me.z + me.vz * .5;
  const margin = game.radius - Math.max(distance, Math.hypot(aheadX, aheadZ));
  if (margin < 1.6) {
    const length = distance || 1;
    return { x: -me.x / length, z: -me.z / length, dash: game.radius - distance < .7 && me.dashCooldown <= 0 && (me.vx * me.x + me.vz * me.z) > 0 };
  }
  // Bots take a moment to get going so a round is not decided in the first second.
  const warmup = Math.min(1, Math.max(.25, (ROUND_SECONDS - game.time) / 1.5));
  let target: BumperPlayer | null = null, best = Infinity;
  for (const other of game.players) {
    if (other === me || !other.alive) continue;
    // Rivals already near the rim are the easiest to finish.
    const score = Math.hypot(other.x - me.x, other.z - me.z) - Math.hypot(other.x, other.z) * .35;
    if (score < best) { best = score; target = other; }
  }
  if (!target) return { x: 0, z: 0, dash: false };
  const reach = Math.hypot(target.x, target.z) || 1;
  const outX = target.x / reach, outZ = target.z / reach;
  const toX = target.x - me.x, toZ = target.z - me.z, gap = Math.hypot(toX, toZ) || 1;
  const aligned = (toX * outX + toZ * outZ) / gap;
  let goX: number, goZ: number, dash = false;
  if (aligned > .45 || reach < 1.5) {
    goX = toX / gap; goZ = toZ / gap;
    // Only charge with room to stop afterwards; a rival on the rim just needs a nudge.
    const room = game.radius - distance, rivalRoom = game.radius - reach;
    dash = warmup >= 1 && me.dashCooldown <= 0 && gap < 4.5 && aligned > .65 && room > 3.5 && rivalRoom > 1 && random() < .15;
  } else {
    // Circle to the centre side of the rival before charging.
    const pointX = target.x - outX * 2.6 - me.x, pointZ = target.z - outZ * 2.6 - me.z, length = Math.hypot(pointX, pointZ) || 1;
    goX = pointX / length; goZ = pointZ / length;
  }
  return { x: goX * warmup, z: goZ * warmup, dash };
}

export function tickBumper(game: BumperGame, dt: number, random: () => number = Math.random) {
  if (game.phase === 'lobby' || game.phase === 'finished') return;
  if (game.phase === 'countdown') {
    game.countdown -= dt;
    if (game.countdown <= 0) { game.countdown = 0; game.phase = 'playing'; }
    return;
  }
  if (game.phase === 'roundEnd') {
    game.pause -= dt;
    for (const player of game.players) if (!player.alive) player.fall += dt;
    if (game.pause > 0) return;
    const champion = game.players.find(p => p.score >= game.target);
    if (champion) {
      game.phase = 'finished'; game.winner = `${champion.name} 우승`;
      for (const player of game.players) player.ready = player.bot;
      place(game);
    } else beginRound(game);
    return;
  }

  game.time -= dt;
  const elapsed = ROUND_SECONDS - game.time;
  if (game.time <= 0) game.radius = Math.max(.6, game.radius - SUDDEN_SHRINK * dt);
  else if (elapsed > SHRINK_AFTER) game.radius = Math.max(ARENA_MIN, game.radius - SHRINK_PER_SEC * dt);

  const cars = game.players.filter(p => p.alive);
  for (const car of cars) {
    const input = car.bot ? bumperBot(game, car, random) : car.connected ? car.input : { x: 0, z: 0, dash: false };
    let ix = input.x, iz = input.z;
    const strength = Math.hypot(ix, iz);
    if (strength > 1) { ix /= strength; iz /= strength; }
    car.dashCooldown = Math.max(0, car.dashCooldown - dt);
    car.dashTime = Math.max(0, car.dashTime - dt);
    car.stun = Math.max(0, car.stun - dt);
    car.lastHitAge += dt;
    if (input.dash && car.dashCooldown <= 0) {
      const dirX = strength > .1 ? ix / Math.min(1, strength) : Math.sin(car.yaw), dirZ = strength > .1 ? iz / Math.min(1, strength) : Math.cos(car.yaw);
      const length = Math.hypot(dirX, dirZ) || 1;
      car.vx = dirX / length * DASH_SPEED; car.vz = dirZ / length * DASH_SPEED;
      car.dashTime = DASH_TIME; car.dashCooldown = DASH_COOLDOWN;
      emit(game, { type: 'dash', x: car.x, z: car.z, a: car.slot, b: -1, power: 1 });
    }
    const control = car.stun > 0 ? .2 : 1;
    car.vx += ix * ACCEL * control * dt; car.vz += iz * ACCEL * control * dt;
    const drag = Math.exp(-DRAG * dt);
    car.vx *= drag; car.vz *= drag;
    const speed = Math.hypot(car.vx, car.vz);
    // Driving alone tops out at MAX_SPEED; dashes and knock-backs may exceed it and bleed off.
    if (speed > MAX_SPEED && car.dashTime <= 0 && car.stun <= 0) {
      const scale = Math.max(MAX_SPEED / speed, 1 - 6 * dt);
      car.vx *= scale; car.vz *= scale;
    }
    car.x += car.vx * dt; car.z += car.vz * dt;
    if (speed > .6) car.yaw = Math.atan2(car.vx, car.vz);
  }

  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    let nx = b.x - a.x, nz = b.z - a.z;
    const distance = Math.hypot(nx, nz);
    if (distance >= CAR_RADIUS * 2) continue;
    if (distance < 1e-6) { nx = 1; nz = 0; } else { nx /= distance; nz /= distance; }
    const overlap = CAR_RADIUS * 2 - distance;
    a.x -= nx * overlap / 2; a.z -= nz * overlap / 2; b.x += nx * overlap / 2; b.z += nz * overlap / 2;
    const av = a.vx * nx + a.vz * nz, bv = b.vx * nx + b.vz * nz, closing = av - bv;
    if (closing <= 0) continue;
    // Equal masses: swap the normal components, then reward the car that was charging.
    const attacker = av > -bv ? a : b, victim = attacker === a ? b : a;
    const boosted = attacker.dashTime > 0;
    const push = closing * (boosted ? 1.6 : 1.2);
    const sign = attacker === a ? 1 : -1;
    victim.vx += nx * sign * push; victim.vz += nz * sign * push;
    attacker.vx -= nx * sign * closing * (boosted ? .7 : .95); attacker.vz -= nz * sign * closing * (boosted ? .7 : .95);
    victim.stun = STUN_TIME; victim.lastHitBy = attacker.id; victim.lastHitAge = 0;
    if (closing > 2.5) emit(game, { type: 'hit', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, a: attacker.slot, b: victim.slot, power: Math.min(1, closing / DASH_SPEED) });
  }

  for (const car of cars) {
    if (Math.hypot(car.x, car.z) <= game.radius + CAR_RADIUS * .15) continue;
    car.alive = false; car.fall = 1e-3;
    const hitter = car.lastHitAge <= KO_CREDIT ? game.players.find(p => p.id === car.lastHitBy) : undefined;
    if (hitter) hitter.kos++;
    emit(game, { type: 'fall', x: car.x, z: car.z, a: hitter?.slot ?? -1, b: car.slot, power: 1 });
  }
  for (const player of game.players) if (!player.alive) player.fall += dt;

  const alive = game.players.filter(p => p.alive);
  if (alive.length <= 1) {
    const winner = alive[0] ?? null;
    if (winner) winner.score++;
    game.roundWinner = winner?.id ?? null;
    game.pause = INTERMISSION; game.phase = 'roundEnd';
  }
}

const round = (value: number) => Math.round(value * 100) / 100;
/** Snapshot sent to every client. Nothing here is secret. */
export function bumperView(game: BumperGame) {
  return {
    code: game.code, title: game.title, phase: game.phase, radius: round(game.radius), time: round(Math.max(0, game.time)),
    countdown: round(game.countdown), round: game.round, target: game.target, roundWinner: game.roundWinner, winner: game.winner,
    events: game.events,
    players: game.players.map(p => ({
      id: p.id, name: p.name, slot: p.slot, bot: p.bot, connected: p.connected, ready: p.ready,
      x: round(p.x), z: round(p.z), yaw: round(p.yaw), alive: p.alive, fall: round(p.fall),
      dash: round(p.dashCooldown), dashing: p.dashTime > 0, score: p.score, kos: p.kos, member: p.member,
    })),
  };
}
export type BumperView = ReturnType<typeof bumperView>;
