import { gameArt, gameAccent } from './game-art.ts';
/** Search, category selection and pagination share one card collection. */
export function initGameFinder() {
  const root = document.getElementById('hub')!;
  const search = root.querySelector<HTMLInputElement>('#game-search')!;
  const cells = [...root.querySelectorAll<HTMLElement>('.game-cell')];
  const cards = cells.map(cell => cell.querySelector<HTMLButtonElement>('.game-option')).filter((card): card is HTMLButtonElement => !!card);
  for (const cell of cells) {
    const kind = cell.dataset.game ?? 'cleaver';
    cell.style.setProperty('--game-accent', gameAccent(kind));
    const cover = cell.querySelector<HTMLElement>('.game-cover');
    if (cover) cover.innerHTML = gameArt(kind, true);
  }
  const filters = [...root.querySelectorAll<HTMLButtonElement>('[data-filter]')];
  const compact = matchMedia('(max-width: 480px), (orientation: landscape) and (max-height: 650px)');
  const previous = root.querySelector<HTMLButtonElement>('#game-previous')!;
  const next = root.querySelector<HTMLButtonElement>('#game-next')!;
  let category = 'all', page = 0;
  const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g, '');
  const categoryTerms: Record<string, string> = { '3d': '3D 실시간', board: '보드 전략', mind: '심리 추리 블러핑' };
  const entries = cells.map(cell => {
    const groups = cell.dataset.groups?.split(' ') ?? [];
    return { cell, groups, text: normalize(`${cell.textContent ?? ''} ${groups.map(group => categoryTerms[group] ?? '').join(' ')}`) };
  });
  void cards;
  function render() {
    const query = normalize(search.value);
    const matches = entries.filter(entry => (category === 'all' || entry.groups.includes(category)) && entry.text.includes(query));
    const size = compact.matches ? 6 : 9;
    const pages = Math.max(1, Math.ceil(matches.length / size));
    page = Math.min(page, pages - 1);
    const visible = new Set(matches.slice(page * size, (page + 1) * size).map(entry => entry.cell));
    for (const cell of cells) cell.hidden = !visible.has(cell);
    root.querySelector('#game-results')!.textContent = `${matches.length}개 게임`;
    root.querySelector('#game-page')!.textContent = `${page + 1} / ${pages}`;
    root.querySelector<HTMLElement>('#game-empty')!.hidden = matches.length > 0;
    previous.disabled = page === 0;
    next.disabled = page === pages - 1;
    root.querySelector<HTMLElement>('.game-pagination')!.hidden = pages === 1;
  }
  search.addEventListener('input', () => { page = 0; render(); });
  for (const button of filters) button.onclick = () => {
    category = button.dataset.filter ?? 'all'; page = 0;
    for (const filter of filters) {
      filter.classList.toggle('selected', filter === button);
      filter.setAttribute('aria-pressed', String(filter === button));
    }
    render();
  };
  previous.onclick = () => { page--; render(); };
  next.onclick = () => { page++; render(); };
  root.querySelector<HTMLButtonElement>('#game-reset')!.onclick = () => {
    search.value = ''; filters[0].click(); search.focus();
  };
  compact.addEventListener('change', () => { page = 0; render(); });
  render();
}
