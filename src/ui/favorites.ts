/** Favourite (찜) games, kept in this browser only. */
const KEY = 'sideplay-favorites';
const listeners = new Set<() => void>();

export function favorites(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}
export function isFavorite(game: string) { return favorites().includes(game); }
/** Flips the game in or out of the favourites (newest first) and returns whether it is now a favourite. */
export function toggleFavorite(game: string) {
  const list = favorites().filter(item => item !== game);
  const added = list.length === favorites().length;
  if (added) list.unshift(game);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage blocked: the change lasts until reload */ }
  for (const listener of listeners) listener();
  return added;
}
export function onFavoritesChange(listener: () => void) { listeners.add(listener); }
