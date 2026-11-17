/**
 * A map of the most recently remembered entries: `key` becomes the newest, and the oldest go past `limit`. Returns a
 * new map (the one given stays as it was), so it can sit in a signal. Plain TypeScript, no UI.
 */
export function rememberRecent<K, V>(map: ReadonlyMap<K, V>, key: K, value: V, limit: number): Map<K, V> {
  const next = new Map(map);
  // Deleted first, so it is set again at the end: a Map keeps insertion order, oldest first.
  next.delete(key);
  next.set(key, value);
  for (const oldest of next.keys()) {
    if (next.size <= limit) break;
    next.delete(oldest);
  }
  return next;
}
