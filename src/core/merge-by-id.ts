/** Items of both lists by id, the incoming ones replacing those with the same id; the existing order first. */
export function mergeById<T extends { id: string | number }>(existing: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map<string | number, T>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}
