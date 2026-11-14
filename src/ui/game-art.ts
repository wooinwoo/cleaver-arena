import type { TableCover } from '../games/types.ts';
import { COVER as reversi } from '../games/reversi.ts';
import { COVER as onecard } from '../games/onecard.ts';
import { COVER as yut } from '../games/yut.ts';
import { COVER as connect4 } from '../games/connect4.ts';
import { COVER as liardice } from '../games/liardice.ts';
import { COVER as mancala } from '../games/mancala.ts';
import { COVER as dots } from '../games/dots.ts';
/** Covers that ship with the modular games (src/games/<id>.ts). */
const MODULAR_COVERS: Record<string, TableCover> = { reversi, onecard, yut, connect4, liardice, mancala, dots };
/**
 * Original key-art covers shared by the library, room identity and waiting stage.
 * [base, glow, accent]: base tints the deep backdrop, glow is the key light behind the focal object,
 * accent is the UI colour (see gameAccent).
 *
 * Art conventions (also for COVER.art in the modular games): light comes from the upper right, the
 * focal object sits slightly right of centre (x≈180), ids are written `id="@name"` / `url(#@name)` and
 * get a per-call prefix, and the frame provides shared defs: `@sh` drop shadow, `@bl` soft blur for
 * contact shadows, `@gw` wide glow blur. The frame's own backdrop ids start with `@f`; avoid those.
 */
const themes: Record<string, [string, string, string]> = {
  cleaver: ['#12505a', '#74ecd8', '#4fe3c1'], quoridor: ['#5e3a1f', '#ffc07a', '#ffb36b'],
  gomoku: ['#1d4752', '#a8e2ea', '#7fd0e4'], poker: ['#4f1f4a', '#ff9bd8', '#f39ad2'],
  janggi: ['#5a4214', '#ffd76a', '#ffd35c'], chess: ['#262f6a', '#a6b8ff', '#9bb2ff'],
  splendor: ['#124a38', '#7ff2bb', '#6fe0a5'], davinci: ['#263c52', '#bcd8f2', '#a9c9e8'],
  coup: ['#5c1c22', '#ffaa80', '#ff8f7b'], bumper: ['#1d2f5e', '#7ef0c8', '#6fe0b6'],
};
let serial = 0;
type Pt = [number, number];
const n1 = (n: number) => +n.toFixed(1);
const hex = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
const stops = (colors: string[]) => colors.map((c, i) => `<stop offset="${+(i / (colors.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('');
const lin = (id: string, colors: string[], x2 = 0, y2 = 1) => `<linearGradient id="@${id}" x2="${x2}" y2="${y2}">${stops(colors)}</linearGradient>`;
const rad = (id: string, colors: string[], fx = .5, fy = .5) => `<radialGradient id="@${id}" fx="${fx}" fy="${fy}">${stops(colors)}</radialGradient>`;
/** Light-to-dark ramp of one colour, for gradients lit from the upper right. */
const ramp = (c: string, lift = .55, drop = .5) => [mix(c, '#ffffff', lift), c, mix(c, '#000000', drop)];
const path = (p: Pt[], fill: string, extra = '') => `<path d="M${p.map(([x, y]) => `${n1(x)} ${n1(y)}`).join('L')}Z" fill="${fill}"${extra}/>`;
const soft = (cx: number, cy: number, rx: number, ry: number, o = .5) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity="${o}" filter="url(#@bl)"/>`;
const glow = (cx: number, cy: number, r: number, color: string, o = .5) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="${o}" filter="url(#@gw)"/>`;
const sparkle = (x: number, y: number, s: number, color = '#fff') => `<path d="M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z" fill="${color}"/>`;
const star = (x: number, y: number, n: number, r1: number, r2: number, fill: string) => path(Array.from({ length: n * 2 }, (_, i) => {
  const a = Math.PI * i / n - Math.PI / 2, r = i % 2 ? r2 : r1;
  return [x + Math.cos(a) * r, y + Math.sin(a) * r] as Pt;
}), fill);
/** Centred bold label; the font comes from the art group in gameArt. */
const text = (x: number, y: number, value: string, color: string, size: number) => `<text x="${x}" y="${y}" fill="${color}" font-size="${size}">${value}</text>`;
/** An affine ground plane: board coordinates (u, v) to screen. */
function plane(a: number, b: number, c: number, d: number, e: number, f: number) {
  return { at: (u: number, v: number): Pt => [e + a * u + c * v, f + b * u + d * v], m: (lift = 0) => `matrix(${a} ${b} ${c} ${d} ${e} ${f - lift})` };
}
/** Extrudes a convex top face `p` downward by `h`, drawing only the faces turned to the viewer. */
function prism(p: Pt[], h: number, top: string, left: string, right: string) {
  const cy = p.reduce((s, q) => s + q[1], 0) / p.length;
  let out = '';
  p.forEach((q, i) => {
    const r = p[(i + 1) % p.length];
    if ((q[1] + r[1]) / 2 < cy) return;
    const [a, b] = q[0] < r[0] ? [q, r] : [r, q];
    out += path([q, r, [r[0], r[1] + h], [q[0], q[1] + h]], (b[1] - a[1]) / (b[0] - a[0] || 1) > .15 ? left : right);
  });
  return out + path(p, top);
}
const quad = (P: ReturnType<typeof plane>, u0: number, v0: number, u1: number, v1: number, lift = 0): Pt[] =>
  [P.at(u0, v0), P.at(u1, v0), P.at(u1, v1), P.at(u0, v1)].map(([x, y]) => [x, y - lift]);
function pawn(x: number, y: number, s: number, id: string) {
  return `<g transform="translate(${x} ${y}) scale(${s})">${soft(0, 2, 17, 4.5, .6)}<path d="M-14 0Q-15-17-8-25H8Q15-17 14 0Q0 6-14 0Z" fill="url(#@${id})"/><circle cy="-33" r="11" fill="url(#@${id}h)"/><path d="M9-24Q15-17 14 0" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/></g>`;
}
const pawnPaint = (id: string, c: string) => lin(id, [mix(c, '#000000', .55), c, mix(c, '#ffffff', .55)], 1, 0) + rad(id + 'h', [mix(c, '#ffffff', .75), c, mix(c, '#000000', .45)], .68, .28);

function cleaverArt() {
  return `<defs>${rad('ar', ['#5fd2bd', '#1f6e69', '#0b2e33'])}${lin('bd', ['#f6fcfc', '#c3d5d8', '#6c838b'])}${lin('hd', ['#7a4c34', '#3a2216', '#1c100a'])}${lin('tr', ['#dffaf000', '#dffaf0aa'], 1, 0)}${pawnPaint('pa', '#8ef0b0')}${pawnPaint('pb', '#ff9a7e')}</defs>`
    + `<ellipse cx="180" cy="117" rx="128" ry="29" fill="#041416"/><ellipse cx="180" cy="110" rx="128" ry="29" fill="url(#@ar)"/>`
    + `<ellipse cx="180" cy="110" rx="127" ry="28.4" stroke="#9ff5dc" stroke-opacity=".6" stroke-width="1.2"/><ellipse cx="180" cy="110" rx="94" ry="19.5" stroke="#c9fbe8" stroke-opacity=".28" stroke-dasharray="6 5"/><path d="M180 81.6V138.4" stroke="#c9fbe8" stroke-opacity=".3" stroke-width="1.5"/>`
    + soft(196, 111, 34, 6, .5) + pawn(104, 108, .92, 'pa') + pawn(250, 116, 1.08, 'pb')
    + glow(192, 46, 42, '#bafff0', .35)
    + `<path d="M92 30h26M100 42h20M88 54h24" stroke="#dffaf0" stroke-opacity=".45" stroke-width="2.5" stroke-linecap="round"/>`
    + `<g transform="translate(194 46) rotate(-20)"><path d="M-150 2Q-108-6-66 0" stroke="url(#@tr)" stroke-width="16" stroke-linecap="round"/>`
    + `<rect x="-76" y="-6.5" width="42" height="13" rx="6.5" fill="url(#@hd)"/><path d="M-72-4H-38" stroke="#fff" stroke-opacity=".25"/><circle cx="-64" r="1.8" fill="#d8e0e2"/><circle cx="-50" r="1.8" fill="#d8e0e2"/><rect x="-37" y="-9" width="7" height="18" rx="2" fill="#93a5ab"/>`
    + `<path d="M-31-22H32Q43-22 43-12V12Q10 25-31 21Z" fill="url(#@bd)"/><path d="M-31 15Q10 19 43 7V12Q10 25-31 21Z" fill="#fff" opacity=".65"/><path d="M-6-22H8L-6 21.6-20 21Z" fill="#fff" opacity=".22"/><path d="M-29-20.6H32" stroke="#fff" stroke-width="1.6"/><circle cx="30" cy="-10" r="4.6" fill="#0d3236"/></g>`;
}

function bumperArt() {
  const bulbs = Array.from({ length: 18 }, (_, i) => {
    const a = i / 18 * Math.PI * 2, x = n1(180 + 126 * Math.cos(a)), y = n1(110 + 28 * Math.sin(a));
    return `<circle cx="${x}" cy="${y}" r="${n1(1.3 + (Math.sin(a) + 1) * .8)}" fill="${i % 2 ? '#ffe39a' : '#ff9ad0'}"/>`;
  }).join('');
  const car = (x: number, y: number, flip: number, id: string) => `<g transform="translate(${x} ${y}) scale(${flip} 1)">${soft(0, 10, 38, 8, .65)}<ellipse cy="6" rx="35" ry="15" fill="#0b0e13"/><ellipse cy="2" rx="35" ry="14.5" fill="#2b3139"/><ellipse cy="1" rx="33.5" ry="13.4" stroke="#69737e"/>`
    + `<path d="M-29 1Q-30-14-12-16H14Q30-14 29 1Q0 12-29 1Z" fill="url(#@${id})"/><path d="M-18-30V-110" stroke="#9fb0c4" stroke-width="2"/><path d="M-26-12Q-28-31-11-31Q0-31 0-14Z" fill="#141920"/><path d="M-25-14Q-27-30-11-30" stroke="#fff" stroke-opacity=".3"/>`
    + `<path d="M6-11l9-7" stroke="#141920" stroke-width="3" stroke-linecap="round"/><path d="M-21-6Q0-14 21-8" stroke="#fff" stroke-opacity=".65" stroke-width="2" stroke-linecap="round"/></g>`;
  return `<defs>${rad('ar', ['#3a5f9e', '#1b2f63', '#0a1433'])}${lin('ca', ramp('#a8ec5a', .5, .55))}${lin('cb', ramp('#ff6f61', .45, .55))}</defs>`
    + `<ellipse cx="180" cy="117" rx="128" ry="29" fill="#040817"/><ellipse cx="180" cy="110" rx="128" ry="29" fill="url(#@ar)"/>`
    + `<ellipse cx="180" cy="110" rx="126" ry="28" stroke="#ffd36a" stroke-width="3" opacity=".45" filter="url(#@bl)"/><ellipse cx="180" cy="110" rx="96" ry="20" stroke="#e8f4ff" stroke-opacity=".35" stroke-width="1.5" stroke-dasharray="8 7"/>${bulbs}`
    + `<path d="M84 84h22M78 96h26M90 108h16" stroke="#c9ffe9" stroke-opacity=".45" stroke-width="2.5" stroke-linecap="round"/>`
    + car(142, 94, 1, 'ca') + car(222, 100, -1, 'cb')
    + glow(182, 78, 20, '#fff1a8', .8) + star(182, 78, 8, 18, 6, '#fff4c2') + star(182, 78, 8, 9, 3.5, '#ffffff')
    + `<path d="M170 58l-5-8M196 60l6-7M201 84l9 3" stroke="#fff4c2" stroke-width="2" stroke-linecap="round"/>`;
}

function quoridorArt() {
  const P = plane(1.06, .42, -1.06, .42, 182, 30), c = 100 / 9;
  const grooves = Array.from({ length: 8 }, (_, k) => `M${n1((k + 1) * c)} 1.5V98.5M1.5 ${n1((k + 1) * c)}H98.5`).join('');
  const wall = (u0: number, v0: number, u1: number, v1: number) => prism(quad(P, u0, v0, u1, v1, 14), 14, '#d0925c', '#3a2010', '#7a4826');
  const at = (i: number, j: number) => P.at((i + .5) * c, (j + .5) * c);
  const [ax, ay] = at(5, 3), [bx, by] = at(2, 7);
  return `<defs>${lin('wd', ['#f0c48e', '#d29a5e', '#a86c3a'], 1, 1)}${pawnPaint('pa', '#7fe8c4')}${pawnPaint('pb', '#ff9b7c')}</defs>`
    + soft(180, 116, 120, 14, .6) + prism(quad(P, 0, 0, 100, 100), 9, 'url(#@wd)', '#3d2414', '#6b4426')
    + `<g transform="${P.m()}"><path d="${grooves}" stroke="#8a5a32" stroke-width="1.3"/><path d="${grooves}" stroke="#ffe7c2" stroke-opacity=".35" stroke-width=".5" transform="translate(.8 .8)"/><path d="M2 1.5H98" stroke="#ffd9a0" stroke-opacity=".6"/></g>`
    + wall(c * 3, c * 6 - 1.2, c * 5, c * 6 + 1.2) + wall(c * 4 - 1.2, c * 1, c * 4 + 1.2, c * 3)
    + pawn(n1(bx), n1(by), .95, 'pb') + wall(c * 4, c * 4 - 1.2, c * 6, c * 4 + 1.2) + pawn(n1(ax), n1(ay), 1.15, 'pa')
    + glow(n1(ax), n1(ay) - 34, 16, '#d6fff0', .45);
}

function gomokuArt() {
  const P = plane(1.5, .12, -.56, .52, 132, 46);
  const g = (i: number) => 10 + i * 10;
  const lines = Array.from({ length: 9 }, (_, k) => `M${g(k)} 10V90M10 ${g(k)}H90`).join('');
  const stone = (i: number, j: number, black: boolean, lift = 0, s = 1) => {
    const [x, y] = P.at(g(i), g(j));
    return (lift ? soft(n1(x), n1(y), 8, 3, .55) : `<ellipse cx="${n1(x)}" cy="${n1(y + 1.8)}" rx="8" ry="4.4" fill="#000" opacity=".45"/>`)
      + `<ellipse cx="${n1(x)}" cy="${n1(y - lift)}" rx="${n1(7.8 * s)}" ry="${n1(4.8 * s)}" fill="url(#@${black ? 'sb' : 'sw'})"/>`;
  };
  const [lx, ly] = P.at(g(2), g(6)), [hx, hy] = P.at(g(6), g(2));
  return `<defs>${lin('wd', ['#f2d3a0', '#ddb57c', '#b88a55'], 1, 1)}${rad('sb', ['#7c858c', '#20262c', '#07090b'], .62, .22)}${rad('sw', ['#ffffff', '#ece8dc', '#a8a393'], .62, .22)}</defs>`
    + soft(180, 116, 118, 13, .6) + prism([P.at(0, 0), P.at(100, 0), P.at(100, 100), P.at(0, 100)], 8, 'url(#@wd)', '#5a3c1f', '#80592f')
    + `<g transform="${P.m()}"><path d="${lines}" stroke="#7d5a33" stroke-width=".9"/>${[[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]].map(([u, v]) => `<circle cx="${u}" cy="${v}" r="1.6" fill="#7d5a33"/>`).join('')}</g>`
    + [[3, 3], [4, 6], [6, 4], [1, 5], [5, 1]].map(([i, j]) => stone(i, j, false)).join('')
    + `<path d="M${n1(lx)} ${n1(ly)}L${n1(hx)} ${n1(hy)}" stroke="#ff6a3d" stroke-width="8" stroke-linecap="round" opacity=".75" filter="url(#@bl)"/><path d="M${n1(lx)} ${n1(ly)}L${n1(hx)} ${n1(hy)}" stroke="#e8432e" stroke-width="2.2" stroke-linecap="round"/>`
    + [[2, 6], [3, 5], [4, 4], [5, 3]].map(([i, j]) => stone(i, j, true)).join('')
    + glow(n1(hx), n1(hy) - 20, 14, '#fff6c8', .55) + stone(6, 2, true, 22, 1.3)
    + `<ellipse cx="${n1(hx)}" cy="${n1(hy)}" rx="9" ry="4.4" stroke="#e8432e" stroke-width="1.6"/>` + sparkle(n1(hx) + 13, n1(hy) - 34, 4);
}

function pokerArt() {
  const chips = (x: number, y: number, n: number, c: string) => soft(x, y + 4, 19, 5, .6)
    + Array.from({ length: n }, (_, i) => `<use href="#@ch" x="${x}" y="${y - i * 4}" fill="${c}"/>`).join('');
  const card = (x: number, y: number, rot: number, s: number, rank: string) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" filter="url(#@sh)"><rect x="-19" y="-26" width="38" height="52" rx="4" fill="url(#@cd)"/><rect x="-15.5" y="-22.5" width="31" height="45" rx="2.5" stroke="#c2185b" stroke-opacity=".35"/>${text(0, 10, rank, '#c2185b', 28)}<path d="M-11-19l3 4-3 4-3-4zM11 19l3-4-3-4-3 4z" fill="#c2185b"/></g>`;
  return `<defs>${lin('cd', ['#ffffff', '#f3ecef', '#d9ccd3'], 1, 1)}${pawnPaint('pa', '#c58cf0')}${pawnPaint('pb', '#5fc8d8')}`
    + `<g id="@ch"><ellipse cy="2" rx="16" ry="6"/><ellipse cy="2" rx="16" ry="6" fill="#000" opacity=".45"/><ellipse rx="16" ry="6"/><ellipse rx="13" ry="4.6" fill="none" stroke="#fff" stroke-width="2.4" stroke-dasharray="3.5 3.3" opacity=".85"/><ellipse cx="2" rx="8" ry="2.8" fill="#fff" opacity=".2"/></g></defs>`
    + glow(194, 40, 50, '#ffb3e1', .5) + pawn(124, 130, 1.25, 'pb') + card(124, 70, 6, .5, '3')
    + pawn(196, 136, 2.3, 'pa') + card(196, 34, -5, 1, '7')
    + sparkle(160, 20, 4) + sparkle(232, 16, 3, '#ffd6ef') + `<path d="M166 38l-8-3M222 30l8-5M224 46h8" stroke="#ffd6ef" stroke-width="2" stroke-linecap="round" opacity=".7"/>`
    + chips(158, 132, 3, '#e6457a') + chips(256, 128, 4, '#3a8fd9') + chips(238, 136, 2, '#f2c14e');
}

function janggiArt() {
  const P = plane(1, -.23, .47, .5, 103, 56), c = 30;
  const piece = (i: number, j: number, ch: string, red: boolean, s: number, lift = 0) => {
    const [x, y] = P.at((i + .5) * c, (j + .5) * c), col = red ? '#c0392b' : '#1f7a45';
    return `<g transform="translate(${n1(x)} ${n1(y + 4)}) scale(${s})">${soft(0, 1, 15, 4, .55)}<g transform="translate(0 ${-lift})"><use href="#@pb"/>`
      + `<rect x="-10.5" y="-24.5" width="21" height="20" rx="3" stroke="${col}" stroke-opacity=".45"/>${text(0, -9.5, ch, col, 13)}</g></g>`;
  };
  const lines = 'M30 0V120M60 0V120M0 30H90M0 60H90M0 90H90';
  return `<defs>${lin('wd', ['#f4dcaa', '#e2bd7c', '#b88d4e'], 1, 1)}${lin('pc', ['#fffaf0', '#f2e2c2', '#d9c096'])}`
    + `<g id="@pb"><rect x="-13" y="-24" width="26" height="25" rx="4.5" fill="#8a6434"/><rect x="-13" y="-27" width="26" height="25" rx="4.5" fill="url(#@pc)"/><path d="M-12-26.4H12" stroke="#fff" stroke-opacity=".8"/></g></defs>`
    + soft(176, 112, 92, 16, .6) + prism([P.at(0, 0), P.at(90, 0), P.at(90, 120), P.at(0, 120)], 8, 'url(#@wd)', '#5a4019', '#7d5a26')
    + `<g transform="${P.m()}"><rect width="90" height="30" fill="#c0392b" opacity=".16"/><rect y="90" width="90" height="30" fill="#1f7a45" opacity=".18"/><path d="${lines}" stroke="#8a6434" stroke-width="1.6"/><rect x="1" y="1" width="88" height="118" stroke="#fff3d0" stroke-opacity=".5"/></g>`
    + piece(0, 0, '상', true, .72) + piece(1, 0, '왕', true, .72) + piece(2, 0, '장', true, .72) + piece(1, 1, '자', true, .78)
    + piece(0, 3, '장', false, .95) + piece(2, 3, '상', false, .98)
    + glow(197, 74, 22, '#fff0b0', .55) + piece(1, 3, '왕', false, 1.32, 9) + sparkle(222, 52, 4.5) + sparkle(172, 58, 3, '#fff0b0');
}

function chessArt() {
  const P = plane(.9, .36, -.9, .36, 178, 48);
  const king = 'M-20 0H20L17-7H-17ZM-14-7Q-10-16-9-34H9Q10-16 14-7ZM-13-34H13L11-39H-11ZM-11-39Q-16-50-7-55H7Q16-50 11-39ZM-2-55V-60H-6V-64H-2V-68H2V-64H6V-60H2V-55Z';
  const knight = 'M-18 0H18L15-7H-15ZM-12-7C-15-16-12-23-8-27L-21-28Q-27-30-24-36L-14-50Q-9-56-4-57L-1-65 4-56Q15-50 17-34Q18-20 12-7Z';
  const [kx, ky] = P.at(68.75, 43.75), [nx, ny] = P.at(31.25, 56.25);
  return `<defs><pattern id="@ck" width="25" height="25" patternUnits="userSpaceOnUse"><rect width="25" height="25" fill="#c9d1ee"/><path d="M0 0h12.5v12.5H0zM12.5 12.5H25V25H12.5z" fill="#46507e"/></pattern>${lin('lt', ['#ffffff40', '#00000055'], 0, 1)}${lin('wk', ['#6d7699', '#dfe4f6', '#ffffff'], 1, 0)}${lin('bn', ['#0a0d18', '#232b48', '#56648f'], 1, 0)}</defs>`
    + soft(178, 118, 120, 14, .6) + prism([P.at(0, 0), P.at(100, 0), P.at(100, 100), P.at(0, 100)], 7, '#22284a', '#121731', '#2c3460')
    + `<g transform="${P.m()}"><rect x="3" y="3" width="94" height="94" fill="url(#@ck)" transform="translate(3 3) scale(.94)"/><rect width="100" height="100" fill="url(#@lt)"/></g>`
    + soft(nx, ny, 16, 4, .7) + `<g transform="translate(${n1(nx)} ${n1(ny)}) scale(-1.15 1.15)"><path d="${knight}" fill="#c4cfff"/><path d="${knight}" fill="url(#@bn)" transform="translate(1.6 .8)"/><circle cx="-7.5" cy="-43" r="1.6" fill="#c4cfff"/></g>`
    + glow(kx, ky - 46, 30, '#dce4ff', .4) + soft(kx, ky, 20, 5, .7)
    + `<g transform="translate(${n1(kx)} ${n1(ky)}) scale(1.12)"><path d="${king}" fill="url(#@wk)"/><path d="M9-34Q10-16 14-7M7-55Q16-50 11-39" stroke="#fff" stroke-width="1.2"/><path d="M-12-34H12" stroke="#8b95bb" stroke-width="1.2"/></g>` + sparkle(kx + 22, ky - 70, 4);
}

function gem(x: number, y: number, s: number, rot: number, pal: string[]) {
  const A: Pt = [-48, 0], B: Pt = [-28, -30], C: Pt = [28, -30], D: Pt = [48, 0], F: Pt = [-16, 0], G: Pt = [16, 0], V: Pt = [0, 56];
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">${path([A, B, F], pal[2])}${path([B, C, G, F], pal[1])}${path([C, D, G], pal[0])}${path([A, F, V], pal[4])}${path([F, G, V], pal[3])}${path([G, D, V], pal[2])}`
    + `<path d="M-48 0H48M-28-30-16 0 0 56 16 0 28-30M-48 0 0 56 48 0" stroke="#fff" stroke-opacity=".45" stroke-width="${n1(1.2 / s)}" stroke-linejoin="round"/><path d="M8-27 24-27 13-6Z" fill="#fff" opacity=".55"/></g>`;
}
function splendorArt() {
  const coin = (x: number, y: number) => `<ellipse cx="${x}" cy="${y + 3}" rx="17" ry="6.5" fill="#8a5a12"/><ellipse cx="${x}" cy="${y}" rx="17" ry="6.5" fill="url(#@au)"/><ellipse cx="${x}" cy="${y}" rx="12" ry="4.3" stroke="#fff3b0" stroke-opacity=".7"/>`;
  return `<defs>${lin('au', ['#fff2b0', '#f2c14e', '#b07a16'], 1, 1)}</defs>`
    + glow(186, 60, 56, '#9dffd0', .5) + `<ellipse cx="186" cy="124" rx="70" ry="10" fill="#7ff2bb" opacity=".22" filter="url(#@bl)"/>` + soft(186, 124, 40, 5, .55)
    + gem(124, 92, .42, -16, ['#e8f1ff', '#9cc4ff', '#4f86e8', '#2650b0', '#122a6a'])
    + soft(236, 122, 22, 4, .6) + coin(236, 122) + coin(236, 115) + coin(236, 108)
    + gem(186, 58, 1.05, 0, ['#effff6', '#a6f7cd', '#4fd394', '#1f9a63', '#0b5a3a'])
    + gem(250, 64, .4, 18, ['#ffe9ee', '#ff9fb1', '#e8506e', '#a8223f', '#5c0f22'])
    + sparkle(214, 34, 7) + sparkle(152, 30, 4, '#d8fff0') + sparkle(240, 92, 3.5) + sparkle(110, 64, 3, '#cfe0ff');
}

function davinciArt() {
  const tile = (x: number, y: number, w: number, h: number, black: boolean, num: string, rot = 0) => {
    const d = w * .22;
    return `<g transform="translate(${x} ${y}) rotate(${rot})">${soft(w / 2 + d / 2, h + 1, w * .75, 4, .6)}<path d="M${w} 0l${n1(d)} ${n1(-d * .6)}v${h}l${n1(-d)} ${n1(d * .6)}Z" fill="${black ? '#06090d' : '#8f8878'}"/><path d="M0 0l${n1(d)} ${n1(-d * .6)}h${w}l${n1(-d)} ${n1(d * .6)}Z" fill="${black ? '#56677a' : '#ffffff'}"/>`
      + `<rect width="${w}" height="${h}" rx="2.5" fill="url(#@${black ? 'tb' : 'tw'})"/>${num ? text(w / 2, h * .66, num, black ? '#e9f1f7' : '#28343f', n1(h * .48)) : `<rect x="${n1(w * .2)}" y="${n1(h * .15)}" width="${n1(w * .6)}" height="${n1(h * .7)}" rx="2" stroke="${black ? '#ffffff' : '#000000'}" stroke-opacity=".14"/>`}</g>`;
  };
  return `<defs>${lin('tb', ['#3c4a5a', '#1c242e', '#0e1319'])}${lin('tw', ['#ffffff', '#ece7dc', '#c8c1b1'])}</defs>`
    + `<ellipse cx="184" cy="112" rx="120" ry="22" fill="#bcd8f2" opacity=".12"/>`
    + tile(112, 52, 22, 36, true, '') + tile(140, 50, 22, 36, false, '') + tile(226, 50, 22, 36, true, '') + tile(254, 52, 22, 36, false, '')
    + glow(190, 64, 40, '#e3f0ff', .4)
    + tile(150, 52, 34, 54, false, '7', -6) + tile(196, 50, 34, 54, true, '3', 5) + sparkle(238, 38, 5) + sparkle(146, 40, 3.5);
}

function coupArt() {
  const card = (x: number, y: number, rot: number, inner: string, emblem: string) => `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="-28" y="-42" width="56" height="84" rx="5" fill="url(#@gd)" filter="url(#@sh)"/><rect x="-24.5" y="-38.5" width="49" height="77" rx="3" fill="url(#@${inner})"/><rect x="-21" y="-35" width="42" height="70" rx="2" stroke="#ffd98a" stroke-opacity=".55"/>${emblem}<path d="M-14 26H14M-9 31H9" stroke="#ffd98a" stroke-opacity=".6" stroke-width="2"/></g>`;
  const crown = `<path d="M-15 8-17-12-7-3 0-17 7-3 17-12 15 8Z" fill="url(#@gd)"/><rect x="-15" y="10" width="30" height="5" rx="1.5" fill="url(#@gd)"/><circle cx="0" cy="-19" r="2.4" fill="#ff8f7b"/><circle cx="-17" cy="-14" r="2" fill="#ffe0a0"/><circle cx="17" cy="-14" r="2" fill="#ffe0a0"/>`;
  const dagger = `<path d="M0-24 4.5-8V6h-9V-8Z" fill="#e8eef2"/><path d="M0-24V6" stroke="#9aa8b2"/><rect x="-12" y="6" width="24" height="4" rx="2" fill="url(#@gd)"/><rect x="-2.5" y="10" width="5" height="10" fill="#5a2a1e"/><circle cy="22" r="3" fill="url(#@gd)"/>`;
  const coin = (x: number, y: number) => `<ellipse cx="${x}" cy="${y + 3}" rx="15" ry="5.6" fill="#7a4a10"/><ellipse cx="${x}" cy="${y}" rx="15" ry="5.6" fill="url(#@gd)"/><ellipse cx="${x}" cy="${y}" rx="10.5" ry="3.6" stroke="#fff3c0" stroke-opacity=".7"/>`;
  return `<defs>${lin('gd', ['#fff0b8', '#f0b84e', '#9c6418'], 1, 1)}${lin('cr', ['#a8323c', '#6a1420', '#3a0810'])}${lin('tl', ['#2f6b6a', '#173c40', '#0a2024'])}</defs>`
    + glow(196, 56, 52, '#ffb48a', .45)
    + card(162, 66, -14, 'cr', crown) + card(214, 64, 11, 'tl', dagger)
    + soft(196, 128, 26, 5, .6) + coin(196, 128) + coin(196, 122) + coin(196, 116) + coin(178, 130)
    + `<g transform="translate(252 30) rotate(-25)"><ellipse rx="10" ry="4" fill="#9c6418"/><ellipse cy="-1.2" rx="10" ry="4" fill="url(#@gd)"/></g>` + sparkle(262, 22, 3.5) + sparkle(140, 26, 3, '#ffe0b0');
}

const ARTS: Record<string, () => string> = {
  cleaver: cleaverArt, bumper: bumperArt, quoridor: quoridorArt, gomoku: gomokuArt, poker: pokerArt,
  janggi: janggiArt, chess: chessArt, splendor: splendorArt, davinci: davinciArt, coup: coupArt,
};
export function gameAccent(kind: string) { return (MODULAR_COVERS[kind]?.colors ?? themes[kind] ?? themes.cleaver)[2]; }
export function gameArt(kind: string, compact = false): string {
  const [base, light] = MODULAR_COVERS[kind]?.colors ?? themes[kind] ?? themes.cleaver;
  const deep = mix(base, '#05070b', .52), id = `cv${++serial}`;
  const art = MODULAR_COVERS[kind]?.art ?? (ARTS[kind] ?? cleaverArt)();
  const bg = (fill: string, extra = '') => `<rect x="-300" y="-160" width="900" height="460" fill="${fill}"${extra}/>`;
  const frame = `<defs><radialGradient id="@fbg" gradientUnits="userSpaceOnUse" cx="196" cy="48" r="180"><stop stop-color="${light}" stop-opacity=".7"/><stop offset=".4" stop-color="${base}" stop-opacity=".8"/><stop offset="1" stop-color="${base}" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="@fvg" gradientUnits="userSpaceOnUse" cx="180" cy="60" r="210"><stop offset=".45" stop-opacity="0"/><stop offset="1" stop-opacity=".7"/></radialGradient>`
    + `<linearGradient id="@fray" x2="0" y2="1"><stop stop-color="${light}" stop-opacity=".2"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></linearGradient>`
    + `<pattern id="@fpt" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="3.5" cy="3.5" r=".7" fill="#fff" fill-opacity=".07"/></pattern>`
    + `<filter id="@sh" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dy="5" stdDeviation="4.5" flood-opacity=".5"/></filter>`
    + `<filter id="@bl" x="-50%" y="-80%" width="200%" height="260%"><feGaussianBlur stdDeviation="3"/></filter><filter id="@gw" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="9"/></filter></defs>`
    + bg('url(#@fbg)') + `<path d="M232-10h22L176 150h-40ZM272-10h12L222 150h-22Z" fill="url(#@fray)"/>` + bg('url(#@fpt)') + bg('url(#@fvg)');
  const body = (frame + `<g font-family="system-ui,'Malgun Gothic',sans-serif" font-weight="800" text-anchor="middle">${art}</g>`).replace(/(id="|#)@/g, `$1${id}-`);
  return `<svg viewBox="${compact ? '50 0 210 140' : '0 0 300 140'}" preserveAspectRatio="xMidYMid meet" style="background:${deep}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
}
export function gameIdentity(kind: string, title: string, description: string) {
  if (kind === 'poker') description = '내 카드는 비밀. 눈치로 이기는 한 판.';
  if (kind === 'davinci') description = '숨은 숫자를 찾아내는 추리 대결.';
  if (kind === 'splendor') description = '보석을 모아 완성하는 나만의 전략.';
  return `<div class="game-identity"><div class="identity-copy"><h1>${title}</h1><p class="table-description">${description}</p></div><div class="identity-art">${gameArt(kind, true)}</div></div>`;
}
export function gameWaiting(kind: string, title: string) {
  return `<div class="waiting-art">${gameArt(kind)}</div><strong>${title}</strong>`;
}
