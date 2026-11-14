/**
 * Game feel for the modular table games: a tiny WebAudio synth (no audio files), a remembered
 * mute toggle, and a per-game memory of the last rendered state so renderers can tell what just
 * changed. Presentation only: nothing here touches game logic or what is sent to the server.
 */
import type { TableRenderContext } from './types.ts';

export type Cue =
  | 'click' | 'place' | 'flip' | 'drop' | 'land' | 'sow' | 'line' | 'box' | 'card' | 'draw' | 'attack'
  | 'shake' | 'roll' | 'sticks' | 'capture' | 'extra' | 'turn' | 'win' | 'lose' | 'tie';

const KEY = 'sideplay-sfx';
let enabled = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
let audio: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

/** Creates or resumes the AudioContext. Only ever called from a user gesture. */
function unlock() {
  if (!enabled) return;
  try {
    if (!audio) {
      audio = new AudioContext();
      master = audio.createGain();
      master.gain.value = 0.22;
      master.connect(audio.destination);
      noiseBuffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (audio.state === 'suspended') void audio.resume();
  } catch { audio = null; }
}
if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, unlock, { capture: true, passive: true });
}

type Tone = { type?: OscillatorType; gain?: number; to?: number; attack?: number };
function tone(t: number, freq: number, dur: number, { type = 'sine', gain = 0.5, to, attack = 0.004 }: Tone = {}) {
  const a = audio!, osc = a.createOscillator(), amp = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(amp).connect(master!);
  osc.start(t); osc.stop(t + dur + 0.03);
}
type Noise = { gain?: number; freq?: number; to?: number; q?: number; filter?: BiquadFilterType };
function noise(t: number, dur: number, { gain = 0.4, freq = 2000, to, q = 1, filter = 'bandpass' }: Noise = {}) {
  const a = audio!, src = a.createBufferSource(), band = a.createBiquadFilter(), amp = a.createGain();
  src.buffer = noiseBuffer;
  band.type = filter; band.Q.value = q;
  band.frequency.setValueAtTime(freq, t);
  if (to) band.frequency.exponentialRampToValueAtTime(to, t + dur);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.003);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(band).connect(amp).connect(master!);
  src.start(t, Math.random() * 0.5, dur + 0.03);
}
const clack = (t: number, pitch: number, gain = 0.5) => {
  noise(t, 0.05, { freq: pitch * 2.4, q: 6, gain });
  tone(t, pitch, 0.06, { type: 'triangle', gain: gain * 0.6, to: pitch * 0.8 });
};
const jitter = (spread: number) => 1 + (Math.random() - 0.5) * spread;

const CUES: Record<Cue, (t: number) => void> = {
  click: t => tone(t, 880, 0.05, { type: 'triangle', gain: 0.35 }),
  place: t => { tone(t, 520 * jitter(0.06), 0.08, { gain: 0.6, to: 360 }); noise(t, 0.02, { freq: 3000, gain: 0.2 }); },
  flip: t => tone(t, 1150 * jitter(0.1), 0.045, { type: 'triangle', gain: 0.25, to: 1500 }),
  drop: t => noise(t, 0.14, { freq: 700, to: 2200, q: 2, gain: 0.18 }),
  land: t => { tone(t, 190, 0.14, { gain: 0.8, to: 85 }); noise(t, 0.03, { freq: 1800, gain: 0.25 }); },
  sow: t => tone(t, 1500 * jitter(0.15), 0.035, { type: 'triangle', gain: 0.28 }),
  line: t => tone(t, 520, 0.13, { type: 'triangle', gain: 0.3, to: 900 }),
  box: t => { tone(t, 660, 0.08, { type: 'triangle', gain: 0.35 }); tone(t + 0.07, 990, 0.12, { type: 'triangle', gain: 0.35 }); },
  card: t => { noise(t, 0.07, { freq: 4200, filter: 'highpass', gain: 0.22 }); tone(t + 0.05, 300, 0.05, { gain: 0.3 }); },
  draw: t => noise(t, 0.06, { freq: 2600, to: 1400, q: 1.5, gain: 0.22 }),
  attack: t => { for (let i = 0; i < 2; i++) tone(t + i * 0.12, i ? 208 : 233, 0.09, { type: 'square', gain: 0.16 }); },
  shake: t => { for (let i = 0; i < 7; i++) clack(t + i * 0.055 + Math.random() * 0.015, 900 * jitter(0.4), 0.3); },
  roll: t => { [0, 0.07, 0.13, 0.2, 0.3].forEach((dt, i) => clack(t + dt, 700 * jitter(0.3), 0.45 - i * 0.06)); },
  sticks: t => { [0, 0.05, 0.11, 0.19].forEach((dt, i) => clack(t + dt, 420 * jitter(0.35), 0.55 - i * 0.07)); },
  capture: t => { tone(t, 320, 0.22, { type: 'sawtooth', gain: 0.16, to: 110 }); noise(t, 0.08, { freq: 900, gain: 0.25 }); },
  extra: t => { tone(t, 660, 0.08, { type: 'triangle', gain: 0.3 }); tone(t + 0.08, 880, 0.14, { type: 'triangle', gain: 0.3 }); },
  turn: t => { tone(t, 784, 0.14, { gain: 0.35 }); tone(t + 0.11, 1175, 0.2, { gain: 0.3 }); },
  win: t => { [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.09, f, i === 3 ? 0.4 : 0.14, { type: 'triangle', gain: 0.35 })); },
  lose: t => { [392, 330, 262].forEach((f, i) => tone(t + i * 0.13, f, i === 2 ? 0.38 : 0.16, { type: 'triangle', gain: 0.32 })); },
  tie: t => { tone(t, 523, 0.14, { type: 'triangle', gain: 0.3 }); tone(t + 0.14, 523, 0.24, { type: 'triangle', gain: 0.3 }); },
};

/** Plays `name` after `delay` ms when sound is on and the AudioContext is unlocked. */
export function cue(name: Cue, delay = 0) {
  if (!enabled || !audio || audio.state !== 'running') return;
  try { CUES[name](audio.currentTime + 0.01 + Math.max(0, delay) / 1000); } catch { /* audio is a nicety */ }
}

/** True when the player asked the OS for less motion: skip moving animations (sounds still play). */
export const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Web Animations helper that respects reduced motion and never throws. */
export function motion(element: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions) {
  if (!element || calm() || typeof element.animate !== 'function') return null;
  try { return element.animate(frames, options); } catch { return null; }
}

/** Sets an element's animation delay (`--fx-d`) in ms. */
export function delay<T extends HTMLElement>(element: T, ms: number): T {
  element.style.setProperty('--fx-d', `${Math.round(ms)}ms`);
  return element;
}

/** Spacing between `count` staggered beats so the whole run fits in `total` ms (never more than `max`). */
export const gap = (count: number, total: number, max: number) => Math.min(max, total / Math.max(1, count));

/** Centre of `element` relative to the top-left of `frame`'s padding box. */
export function centre(element: Element, frame: Element) {
  const a = element.getBoundingClientRect(), b = frame.getBoundingClientRect();
  return { x: a.left + a.width / 2 - b.left - frame.clientLeft, y: a.top + a.height / 2 - b.top - frame.clientTop };
}

const STYLE = `
#t-toolbar .fx-sound{display:inline-flex;align-items:center;gap:5px;width:auto;margin:0;min-height:44px;min-width:44px;padding:4px 10px;font-size:12px;flex:none;line-height:1}
#t-toolbar .fx-sound svg{width:16px;height:16px;flex:none}
#t-toolbar .fx-sound[aria-pressed='true']{border-color:var(--app-accent,#d4f18d)}
#t-toolbar .fx-sound[aria-pressed='false'] .fx-wave{display:none}
#t-toolbar .fx-sound[aria-pressed='true'] .fx-slash{display:none}
.fx-myturn{animation:fx-glow .6s ease-out var(--fx-board-d,0ms) both}
.fx-win{animation:fx-glow-win .55s ease-out var(--fx-board-d,0ms) 2 both}
.fx-lose{animation:fx-glow-lose .6s ease-out var(--fx-board-d,0ms) both}
@keyframes fx-glow{0%{outline:3px solid transparent;outline-offset:9px}35%{outline:3px solid var(--app-accent,#d4f18d);outline-offset:3px}100%{outline:3px solid transparent;outline-offset:3px}}
@keyframes fx-glow-win{0%{outline:4px solid transparent;outline-offset:10px}40%{outline:4px solid #f5c638;outline-offset:3px}100%{outline:4px solid transparent;outline-offset:3px}}
@keyframes fx-glow-lose{0%{outline:3px solid transparent;outline-offset:3px}40%{outline:3px solid #9aa3ad;outline-offset:3px}100%{outline:3px solid transparent;outline-offset:3px}}
@media (prefers-reduced-motion:reduce){.fx-myturn,.fx-win,.fx-lose{animation-name:fx-glow-lose}}
`;
function ensureStyle() {
  if (document.getElementById('fx-style')) return;
  const style = document.createElement('style');
  style.id = 'fx-style';
  style.textContent = STYLE;
  document.head.append(style);
}

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none"/>'
  + '<path class="fx-wave" d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10"/>'
  + '<path class="fx-slash" d="M16 9l5 6M21 9l-5 6"/></svg>';

/** The 효과음 on/off button for `ctx.toolbar` (off by default, remembered in localStorage). */
export function soundToggle() {
  ensureStyle();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fx-sound';
  const label = document.createElement('span');
  const sync = () => {
    button.setAttribute('aria-pressed', String(enabled));
    button.title = enabled ? '효과음 끄기' : '효과음 켜기';
    label.textContent = enabled ? '효과음 켬' : '효과음 끔';
  };
  button.innerHTML = ICON;
  button.append(label);
  button.onclick = () => {
    enabled = !enabled;
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch { /* private mode */ }
    if (enabled) { unlock(); cue('click'); }
    sync();
  };
  sync();
  return button;
}

/** Shows the toolbar and appends the sound toggle (skipped in the inert lobby preview). */
export function addSoundToggle(ctx: TableRenderContext<unknown>) {
  if (ctx.preview) return;
  ctx.toolbar.hidden = false;
  ctx.toolbar.append(soundToggle());
}

/**
 * What changed since the last render of this game:
 * - null: nothing new to show (same state, preview, first sight of a game in progress, or a jump
 *   of more than `maxStep` progress, e.g. after a reconnect);
 * - { prev: null }: a new game (rematch) began while the page was open;
 * - { prev }: the state moved forward from `prev`.
 * `progress` must not decrease within one game; a drop means a new game.
 */
export type Step<S> = { prev: S | null };
const memory = new Map<string, { json: string; state: unknown; progress: number }>();
export function track<S>(id: string, ctx: TableRenderContext<S>, progress: (state: S) => number, maxStep = Infinity): Step<S> | null {
  ensureStyle();
  if (ctx.preview) { memory.delete(id); return null; }
  const json = JSON.stringify(ctx.game);
  const now = progress(ctx.game);
  const last = memory.get(id);
  if (last?.json === json) return null;
  memory.set(id, { json, state: JSON.parse(json), progress: now });
  if (!last) return null;
  if (now < last.progress) return { prev: null };
  if (now - last.progress > maxStep) return null;
  return { prev: last.state as S };
}

type Turned = { turn: number; winner: number | null; draw: boolean };
const over = (state: Turned) => state.winner !== null || state.draw;

/** Common cues after a change: "내 차례" when the turn passes to me, win/lose when the game ends. `after` = ms the move's own animation takes. */
export function turnCues<S extends Turned>(ctx: TableRenderContext<S>, step: Step<S> | null, after = 0) {
  if (!step) return;
  const game = ctx.game, board = ctx.board;
  const mark = (className: string) => {
    board.style.setProperty('--fx-board-d', `${Math.round(after)}ms`);
    board.classList.add(className);
  };
  if (step.prev && !over(step.prev) && over(game)) {
    const result = game.draw ? 'tie' : game.winner === ctx.me ? 'win' : 'lose';
    cue(result, after);
    if (result !== 'tie') mark(result === 'win' ? 'fx-win' : 'fx-lose');
    return;
  }
  if (over(game) || game.turn !== ctx.me) return;
  if (step.prev === null || step.prev.turn !== ctx.me) { cue('turn', after); mark('fx-myturn'); }
}
