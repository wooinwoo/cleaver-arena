import type { Action } from './tabletop-types.ts';
import { type DotsState, type DotsLine, adjacentBoxes, lineIndex, openLines, sides } from './dots.ts';

type Lines = Pick<DotsState, 'h' | 'v'>;

const draw = (lines: Lines, line: DotsLine) => { (line.dir === 'h' ? lines.h : lines.v)[lineIndex(line.dir, line.r, line.c)] = 0; };
const completes = (lines: Lines, line: DotsLine) => adjacentBoxes(line.dir, line.r, line.c).some(([r, c]) => sides(lines, r, c) === 3);
const makesThird = (lines: Lines, line: DotsLine) => adjacentBoxes(line.dir, line.r, line.c).some(([r, c]) => sides(lines, r, c) === 2);

/** Boxes the next player can take in a row after `line` is drawn, by greedily closing every box they can. */
function giveaway(lines: Lines, line: DotsLine) {
  const copy: Lines = { h: lines.h.slice(), v: lines.v.slice() };
  draw(copy, line);
  let taken = 0;
  for (;;) {
    const next = openLines(copy).find(candidate => completes(copy, candidate));
    if (!next) return taken;
    const before = adjacentBoxes(next.dir, next.r, next.c).filter(([r, c]) => sides(copy, r, c) === 3).length;
    draw(copy, next);
    taken += before;
  }
}

const toAction = (line: DotsLine): Action => ({ type: 'line', dir: line.dir, r: line.r, c: line.c });
const pick = <T>(items: T[], random: () => number) => items[Math.min(items.length - 1, Math.floor(random() * items.length))];

/**
 * Takes any box it can, otherwise draws a line that leaves no box with three sides,
 * otherwise hands over the fewest boxes (greedy chain count).
 * ponytail: no double-dealing at the end of long chains; add it if players find the bot too easy.
 */
export function dotsBot(state: DotsState, _seat: number, random = Math.random): Action {
  const open = openLines(state);
  const taking = open.filter(line => completes(state, line));
  if (taking.length) return toAction(pick(taking, random));
  const safe = open.filter(line => !makesThird(state, line));
  if (safe.length) return toAction(pick(safe, random));
  let best = Infinity, choices: DotsLine[] = [];
  for (const line of open) {
    const cost = giveaway(state, line);
    if (cost < best) { best = cost; choices = [line]; }
    else if (cost === best) choices.push(line);
  }
  return toAction(pick(choices, random));
}
