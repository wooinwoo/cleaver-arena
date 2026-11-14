import type { TableId } from '../../shared/catalog.ts';
import { createReversi } from '../../shared/reversi.ts';
import { createOneCard, oneCardView } from '../../shared/onecard.ts';
import { createYut } from '../../shared/yut.ts';
import { createConnectFour } from '../../shared/connect4.ts';
import { createLiarDice, liarDiceView } from '../../shared/liardice.ts';
import { createMancala } from '../../shared/mancala.ts';
import { createDots } from '../../shared/dots.ts';

/** Starting position for the lobby preview, as seat 0 would see it. Null for games without one. */
export function previewState(kind: TableId, seats: number): unknown {
  const count = Math.max(2, seats);
  switch (kind) {
    case 'reversi': return createReversi();
    case 'onecard': return oneCardView(createOneCard(count), 0);
    case 'yut': return createYut(count);
    case 'connect4': return createConnectFour();
    case 'liardice': return liarDiceView(createLiarDice(count), 0);
    case 'mancala': return createMancala();
    case 'dots': return createDots(count);
    default: return null;
  }
}
