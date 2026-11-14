import type { Action } from '../../shared/tabletop-types.ts';

/** Catalog entry each game module exports as `INFO` (shared/<id>.ts) and the hub/catalog read. */
export interface TableInfo {
  title: string;
  min: number;
  max: number;
  /** One short factual line for the hub card (no slogans). */
  description: string;
  /** Full rules shown in the rules dialog. */
  rules: string;
  /** Hub filter groups: 'board' | 'mind' | '3d' (space separated in the card). */
  groups: ('board' | 'mind')[];
}

/** What a game renderer (src/games/<id>.ts) receives. The shell owns everything outside `board` and `toolbar`. */
export interface TableRenderContext<View> {
  /** #t-board. The renderer owns its className and children; it is emptied before each call. */
  board: HTMLElement;
  /** #t-toolbar, hidden before each call. Set `hidden = false` to use it (buttons, counters, choices). */
  toolbar: HTMLElement;
  /** The state as this seat may see it (the game's view function output, or the state itself). */
  game: View;
  /** My seat (0 while previewing before a room exists). */
  me: number;
  playerName(seat: number): string;
  /** True only when it is my turn, the socket is open, nobody is reconnecting and nothing is in flight. */
  canAct: boolean;
  /** room.phase === 'playing' (false in lobby preview and after the game ends). */
  playing: boolean;
  /** True for the inert lobby preview: draw the starting position, no handlers needed. */
  preview: boolean;
  /** Send an action immediately (use for explicit buttons: draw, bid, throw, call...). */
  act(action: Action): void;
  /**
   * Select-then-confirm for taps on a board (reduces mis-taps on phones): highlights `element`,
   * shows `label` in the confirm bar and sends `action` when the player presses 확정.
   */
  choose(action: Action, label: string, element?: HTMLElement): void;
  /** Overrides the status line (e.g. '우인우 차례 · 주사위를 굴리세요'). */
  setTurn(text: string): void;
}

/** A renderer module exports `render(ctx)` plus `COVER` art for the hub card and room bar. */
export interface TableCover {
  /** [dark, light, accent] colours for the cover gradient and accents. */
  colors: [string, string, string];
  /** SVG markup drawn inside a 300×140 viewBox (no outer <svg>). Original art only. */
  art: string;
}
