import type { TableId } from './catalog.ts';
import type { Action, BaseState } from './tabletop-types.ts';
import type { GomokuState } from './gomoku.ts';
import { gomokuBot } from './gomoku-bot.ts';
import type { ReversiState } from './reversi.ts';
import { reversiBot } from './reversi-bot.ts';
import type { OneCardState } from './onecard.ts';
import { oneCardBot } from './onecard-bot.ts';
import type { YutState } from './yut.ts';
import { yutBot } from './yut-bot.ts';
import type { ConnectFourState } from './connect4.ts';
import { connectFourBot } from './connect4-bot.ts';
import type { LiarDiceState } from './liardice.ts';
import { liarDiceBot } from './liardice-bot.ts';
import type { MancalaState } from './mancala.ts';
import { mancalaBot } from './mancala-bot.ts';
import type { DotsState } from './dots.ts';
import { dotsBot } from './dots-bot.ts';

/** Table games a lone player can start against the server bot. Bots for hidden-information games read only their own seat's view. */
export const tableBots: Partial<Record<TableId, (state: BaseState, seat: number) => Action>> = {
  gomoku: (state, seat) => gomokuBot(state as GomokuState, seat),
  reversi: (state, seat) => reversiBot(state as ReversiState, seat),
  onecard: (state, seat) => oneCardBot(state as OneCardState, seat),
  yut: (state, seat) => yutBot(state as YutState, seat),
  connect4: (state, seat) => connectFourBot(state as ConnectFourState, seat),
  liardice: (state, seat) => liarDiceBot(state as LiarDiceState, seat),
  mancala: (state, seat) => mancalaBot(state as MancalaState, seat),
  dots: (state, seat) => dotsBot(state as DotsState, seat),
};
