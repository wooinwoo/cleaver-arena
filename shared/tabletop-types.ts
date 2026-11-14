export type TableGameId = 'quoridor' | 'gomoku' | 'janggi' | 'poker' | 'chess' | 'splendor' | 'davinci' | 'coup'
  | 'reversi' | 'onecard' | 'yut' | 'connect4' | 'liardice' | 'mancala' | 'dots';
export type Action = { type: string; [key: string]: unknown };
export type BaseState = {
  kind: TableGameId;
  turn: number;
  winner: number | null;
  draw: boolean;
  log: string;
};
export const finished = (state: BaseState) => state.winner !== null || state.draw;
export const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
