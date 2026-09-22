/** Original vector covers shared by the library, room identity and waiting stage. */
const themes: Record<string, [string, string, string]> = {
  cleaver: ['#82d3c3', '#d0f1d7', '#4fe3c1'], quoridor: ['#e9b789', '#f8ddb4', '#ffb36b'],
  gomoku: ['#a0c7cd', '#dcebe6', '#7fd0e4'], poker: ['#d5a0c1', '#f3d8df', '#f39ad2'],
  janggi: ['#edc46e', '#fff0b3', '#ffd35c'], chess: ['#a6b6e6', '#dce5fc', '#9bb2ff'],
  splendor: ['#82cfa9', '#dcf1c1', '#6fe0a5'], davinci: ['#b0c5d6', '#e3ebef', '#a9c9e8'],
  coup: ['#eea195', '#ffe0ba', '#ff8f7b'],
};
let serial = 0;
const rect = (x: number, y: number, w: number, h: number, color: string, r = 5) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}"/>`;
const circle = (x: number, y: number, r: number, color: string) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
const text = (x: number, y: number, value: string, color: string, size = 28) => `<text x="${x}" y="${y}" fill="${color}" font-family="system-ui,sans-serif" font-size="${size}" font-weight="800" text-anchor="middle">${value}</text>`;
function pawn(x: number, y: number, color: string) {
  return `<g transform="translate(${x} ${y})">${circle(0, 6, 17, '#0003')}<path d="M-15 0Q-14-16-7-22H7Q14-16 15 0Q0 10-15 0" fill="${color}"/>${circle(0, -28, 11, color)}${circle(-3, -31, 3, '#fff5')}</g>`;
}
function board(cols: number, rows: number, dark: string, light: string) {
  return Array.from({ length: cols * rows }, (_, i) => rect((i % cols) * 25, Math.floor(i / cols) * 25, 24, 24, (i + Math.floor(i / cols)) % 2 ? dark : light, 2)).join('');
}
export function gameAccent(kind: string) { return (themes[kind] ?? themes.cleaver)[2]; }
export function gameArt(kind: string, compact = false): string {
  const [dark, light] = themes[kind] ?? themes.cleaver;
  const id = `cover-${++serial}`;
  let art = '';
  if (kind === 'cleaver') art = `<ellipse cx="154" cy="108" rx="100" ry="28" fill="#092f36"/><ellipse cx="154" cy="98" rx="100" ry="28" fill="#4fa593"/><ellipse cx="154" cy="98" rx="84" ry="21" fill="none" stroke="#9ce1bd" stroke-width="2"/><path d="m147 73 14 49" stroke="#bde9c6" stroke-width="2"/>${pawn(111, 94, '#baf3bc')}${pawn(202, 106, '#ffb39d')}<g transform="translate(163 35) rotate(-25)">${rect(-17, -12, 42, 24, '#eef3e8', 4)}${rect(-18, 11, 10, 24, '#243b40', 3)}${circle(17, -5, 2, '#5e8c8a')}</g><path d="m105 37 28-6m-21 17 16-4m63 10 30-9" stroke="#c7f7da" stroke-width="3" stroke-linecap="round"/>`;
  if (kind === 'quoridor') art = `<g transform="translate(150 25) rotate(21) skewX(-20) scale(1 .67)">${rect(-72, -4, 149, 152, '#513829', 9)}<g transform="translate(-67 0)">${board(6, 6, '#d7aa73', '#edc992')}${rect(24, 50, 76, 8, '#755042', 2)}${rect(75, 75, 8, 70, '#755042', 2)}</g></g>${pawn(112, 83, '#a7e5ce')}${pawn(205, 100, '#f8ac8f')}`;
  if (kind === 'gomoku') art = `<g transform="translate(70 20) rotate(10 80 55)">${rect(0, 7, 168, 110, '#876b4e', 8)}${rect(0, 0, 168, 110, '#e5c69a', 8)}<path d="M14 12v86m28-86v86m28-86v86m28-86v86m28-86v86m28-86v86M14 14h140M14 42h140M14 70h140M14 98h140" stroke="#997c57"/>${[[42, 42], [70, 70], [98, 98], [98, 42]].map(([x, y]) => `${circle(x, y + 3, 12, '#0004')}${circle(x, y, 12, '#25333b')}${circle(x - 3, y - 4, 4, '#43535c')}`).join('')}${[[70, 42], [98, 70], [126, 70]].map(([x, y]) => `${circle(x, y + 3, 12, '#0004')}${circle(x, y, 12, '#fff8e8')}`).join('')}</g>`;
  if (kind === 'poker') art = `<g transform="translate(113 22) rotate(-18 28 48)">${rect(0, 5, 62, 91, '#312b46')}${rect(0, 0, 62, 91, '#edd4cf')}${rect(6, 6, 50, 79, '#855376')}${text(31, 58, '?', '#f8dce0', 42)}</g><g transform="translate(151 22) rotate(15 28 48)">${rect(0, 5, 62, 91, '#312b46')}${rect(0, 0, 62, 91, '#fff3dc')}${text(14, 25, '9', '#b14e67', 18)}<path d="m31 32 13 20-13 20-13-20z" fill="#ba5971"/></g>${[0, 1, 2].map(i => `<ellipse cx="102" cy="${116 - i * 6}" rx="23" ry="8" fill="${i % 2 ? '#e6b986' : '#fae0aa'}" stroke="#a87569" stroke-width="2"/>`).join('')}`;
  if (kind === 'janggi') art = `<g transform="translate(82 18) rotate(-9 70 55)">${rect(0, 7, 139, 107, '#725333', 8)}${rect(0, 0, 139, 107, '#eed4a0', 8)}<path d="M46 4v99M92 4v99M4 35h131M4 70h131" stroke="#ba955f" stroke-width="2"/>${[[8, 5, '상', '#edac88'], [97, 72, '장', '#b6d69a'], [51, 38, '왕', '#f1be60']].map(([x, y, v, c]) => `<g transform="translate(${x} ${y})">${rect(0, 4, 34, 29, '#916e43')}${rect(0, 0, 34, 29, String(c))}${text(17, 21, String(v), '#523c29', 20)}</g>`).join('')}</g>`;
  if (kind === 'chess') art = `<g transform="translate(89 75) rotate(-8) skewX(-27) scale(1 .5)">${board(5, 4, '#687294', '#bec5dc')}</g><g transform="translate(176 27)" fill="#e3e4f0"><path d="M-4-12h9V0h12v8H5v13H-4V8h-12V0H-4zM-20 29Q0 12 21 29L13 62H-12zM-18 63H18L26 78H-27z"/><path d="M-16 39h31" stroke="#a4adc9" stroke-width="3"/></g><g transform="translate(115 41)" fill="#303952"><path d="m-13 0 22-14 16 21-1 16-15 20 10 18H-23l12-28 14-10-14 2-10-10z"/>${circle(10, 1, 2, '#dee0f0')}${rect(-27, 61, 50, 9, '#303952', 3)}</g>`;
  if (kind === 'splendor') art = `<g transform="translate(152 65)"><path d="m-49-16 21-29h56l21 29L0 47z" fill="#c6f4d6"/><path d="M-49-16H49L0 47z" fill="#53b991"/><path d="m-28-45 10 29L0 47 18-16 28-45z" fill="#96e4bb"/><path d="M-18-16H18L0 47z" fill="#ddffdf"/></g><g transform="translate(79 89) rotate(-15)"><path d="m-22-7 10-15h24L22-7 0 22z" fill="#99c5ff"/><path d="M-22-7H22L0 22z" fill="#658ec5"/></g><g transform="translate(226 82) rotate(20)"><path d="m-23-7 11-16h24L23-7 0 23z" fill="#f8bfaa"/><path d="M-23-7H23L0 23z" fill="#d37979"/></g><path d="M86 30v12m-6-6h12m125 71v14m-7-7h14" stroke="#e2efc0" stroke-width="2"/>`;
  if (kind === 'davinci') art = `<g transform="translate(65 31) rotate(-9 90 45)">${[0, 1, 2, 3].map((i) => `<g transform="translate(${i * 45} ${i % 2 * -8})">${rect(0, 5, 39, 77, '#182831', 6)}${rect(0, 0, 39, 77, i % 2 ? '#f4edde' : '#263b48', 6)}${rect(5, 5, 29, 65, 'none', 3)}${text(19, 49, ['3', '?', '8', '?'][i], i % 2 ? '#485c64' : '#d5e5dc', 34)}</g>`).join('')}</g>`;
  if (kind === 'coup') art = `<g transform="translate(104 15) rotate(-13 32 50)">${rect(0, 5, 68, 101, '#482530')}${rect(0, 0, 68, 101, '#ebc39f')}${rect(5, 5, 58, 91, '#93464c')}<path d="m17 28 10 9 7-15 8 15 10-9-4 29H21z" fill="#f2c27e"/><path d="M19 70h30M25 77h18" stroke="#db9a85" stroke-width="3"/></g><g transform="translate(161 28) rotate(14 29 44)">${rect(0, 5, 61, 89, '#482530')}${rect(0, 0, 61, 89, '#f9dfb8')}<path d="M10 30Q30 20 51 30L46 49Q30 63 15 49z" fill="#633b49"/><path d="m19 36 8 4m9 0 8-4" stroke="#f2c486" stroke-width="3"/></g>${circle(109, 119, 13, '#e5b77c')}${circle(109, 119, 8, '#c38d5b')}`;
  return `<svg viewBox="${compact ? '50 0 210 140' : '0 0 300 140'}" preserveAspectRatio="xMidYMid meet" style="background:linear-gradient(135deg,${dark},${light})" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="${id}" x2="1" y2="1"><stop stop-color="${dark}"/><stop offset="1" stop-color="${light}"/></linearGradient><filter id="${id}-shadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="5" stdDeviation="4" flood-opacity=".2"/></filter></defs><circle cx="260" cy="12" r="110" fill="#fff" opacity=".035"/><circle cx="20" cy="150" r="105" fill="#000" opacity=".06"/><g filter="url(#${id}-shadow)">${art}</g></svg>`;
}
export function gameIdentity(kind: string, title: string, description: string) {
  if (kind === 'poker') description = '내 카드는 비밀. 눈치로 이기는 한 판.';
  if (kind === 'davinci') description = '숨은 숫자를 찾아내는 추리 대결.';
  if (kind === 'splendor') description = '보석을 모아 완성하는 나만의 전략.';
  return `<div class="game-identity"><div class="identity-copy"><h1>${title}</h1><p class="table-description">${description}</p></div><div class="identity-art">${gameArt(kind, true)}</div></div>`;
}
export function gameWaiting(kind: string, title: string) {
  return `<div class="waiting-art">${gameArt(kind)}</div><strong>다음 한 판은, ${title}.</strong><p>초대 링크 하나로 모여서 바로 시작하세요.</p>`;
}
