/**
 * Colour lab: try whole-app palettes on top of the slate theme without touching the stylesheets.
 * Opened with `?theme=lab` (remembered in this browser; `?theme=off` closes it). Every colour in the loaded
 * stylesheets is re-tinted: slate greys take the palette's neutral hue, the green action colour becomes the
 * palette accent and the blue selection colour becomes its selection colour. Game cover art is inline SVG and
 * keeps its own colours. A palette that wins gets baked into the real theme files afterwards.
 */
type Palette = { id: string; name: string; note: string; neutralHue?: number; neutralSat?: number; light?: number; accentHue?: number; accentSat?: number; selectHue?: number };
const PALETTES: Palette[] = [
  { id: 'slate', name: '슬레이트', note: '지금 색 · 회청색 + 초록' },
  { id: 'midnight', name: '미드나잇 레드', note: '짙은 남색 + 빨강 · 경쟁 게임 느낌', neutralHue: 230, neutralSat: 1.9, light: .72, accentHue: 354, accentSat: .86, selectHue: 188 },
  { id: 'ember', name: '웜 그라파이트', note: '따뜻한 숯색 + 주황', neutralHue: 24, neutralSat: .55, light: .95, accentHue: 24, accentSat: .92, selectHue: 196 },
  { id: 'violet', name: '딥 퍼플', note: '보라 계열 · 커뮤니티 앱 느낌', neutralHue: 256, neutralSat: 1.5, light: .95, accentHue: 266, accentSat: .78, selectHue: 290 },
  { id: 'carbon', name: '카본 라임', note: '무채색 검정 + 라임', neutralHue: 0, neutralSat: 0, light: .9, accentHue: 88, accentSat: .82, selectHue: 88 },
];
const KEY = 'sideplay-theme-lab';

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > .5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255)) as [number, number, number];
}
function tint(palette: Palette, r: number, g: number, b: number): [number, number, number] {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < .3 || l < .06) {
    // Slate greys (cool, low saturation): move to the palette's neutral hue; darks get the palette's depth.
    const lightness = l < .5 ? l * (palette.light ?? 1) : l;
    return hslToRgb(palette.neutralHue ?? h, Math.min(1, s * (palette.neutralSat ?? 1)), lightness);
  }
  if (h >= 95 && h <= 170) return hslToRgb(palette.accentHue ?? h, palette.accentSat ?? s, l);
  if (h >= 195 && h <= 235) return hslToRgb(palette.selectHue ?? h, s, l);
  return [r, g, b];
}
const HEX = /#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;
const RGB = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)/gi;
function recolour(value: string, palette: Palette) {
  return value
    .replace(HEX, (match, hex: string) => {
      const full = hex.length <= 4 ? [...hex].map(c => c + c).join('') : hex;
      const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
      const out = tint(palette, r, g, b).map(v => v.toString(16).padStart(2, '0')).join('');
      return `#${out}${full.length === 8 ? full.slice(6) : ''}`;
    })
    .replace(RGB, (match, r: string, g: string, b: string, a?: string) => {
      const [nr, ng, nb] = tint(palette, +r, +g, +b);
      return a === undefined ? `rgb(${nr}, ${ng}, ${nb})` : `rgba(${nr}, ${ng}, ${nb}, ${a})`;
    });
}
/** Original declarations, so switching palettes always starts again from slate. */
const originals = new Map<CSSStyleDeclaration, [string, string, string][]>();
function eachStyle(rules: CSSRuleList, visit: (style: CSSStyleDeclaration) => void) {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule && !rule.selectorText.includes('theme-lab')) visit(rule.style);
    if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) eachStyle((rule as CSSGroupingRule).cssRules, visit);
  }
}
function apply(palette: Palette) {
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    eachStyle(rules, style => {
      if (!originals.has(style)) {
        const declarations: [string, string, string][] = [];
        for (let i = 0; i < style.length; i++) {
          const name = style.item(i), value = style.getPropertyValue(name);
          if (/#|rgb/i.test(value)) declarations.push([name, value, style.getPropertyPriority(name)]);
        }
        originals.set(style, declarations);
      }
      for (const [name, value, priority] of originals.get(style)!) style.setProperty(name, palette.id === 'slate' ? value : recolour(value, palette), priority);
    });
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = palette.id === 'slate' ? '#12161d' : recolour('#12161d', palette);
  document.body.style.backgroundColor = palette.id === 'slate' ? '' : recolour('#12161d', palette);
}
export function initThemeLab() {
  const param = new URLSearchParams(location.search).get('theme');
  if (param === 'off') localStorage.removeItem(KEY);
  else if (param === 'lab') localStorage.setItem(KEY, localStorage.getItem(KEY) || 'slate');
  const stored = localStorage.getItem(KEY);
  if (!stored) return;
  const panel = document.createElement('aside');
  panel.className = 'theme-lab';
  panel.setAttribute('aria-label', '색감 실험');
  panel.innerHTML = '<div class="theme-lab-head"><strong>색감 실험</strong><button type="button" class="theme-lab-close" aria-label="색감 실험 닫기">×</button></div><div class="theme-lab-list"></div><p class="theme-lab-note"></p>';
  const list = panel.querySelector('.theme-lab-list')!, note = panel.querySelector('.theme-lab-note')!;
  const select = (palette: Palette) => {
    localStorage.setItem(KEY, palette.id);
    apply(palette);
    note.textContent = palette.note;
    for (const button of list.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.palette === palette.id));
  };
  for (const palette of PALETTES) {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: palette.name });
    button.dataset.palette = palette.id;
    const swatch = document.createElement('i');
    swatch.style.background = `linear-gradient(90deg, ${palette.id === 'slate' ? '#12161d' : recolour('#12161d', palette)} 0 50%, ${palette.id === 'slate' ? '#45b864' : recolour('#45b864', palette)} 50%)`;
    button.prepend(swatch);
    button.onclick = () => select(palette);
    list.append(button);
  }
  panel.querySelector<HTMLButtonElement>('.theme-lab-close')!.onclick = () => { localStorage.removeItem(KEY); apply(PALETTES[0]); panel.remove(); };
  document.body.append(panel);
  // Stylesheets may still be loading in development; tint once everything is in.
  const start = () => select(PALETTES.find(palette => palette.id === stored) ?? PALETTES[0]);
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
}
