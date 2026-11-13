import type { TableId } from './catalog.ts';
import type { Action, BaseState } from './tabletop-types.ts';
import type { GomokuState } from './gomoku.ts';
import { gomokuBot } from './gomoku-bot.ts';

/** Table games a lone player can start against the server bot. */
export const tableBots: Partial<Record<TableId, (state: BaseState, seat: number) => Action>> = {
  gomoku: (state, seat) => gomokuBot(state as GomokuState, seat),
};
