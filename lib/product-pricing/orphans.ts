/**
 * Stage 36 (PP-25): a stored row is orphaned when its combination key is not produced by the current catalog
 * config. Pure; the admin page and tests share it.
 */
export function findOrphans(storedKeys: readonly string[], generatedKeys: Iterable<string>): string[] {
  const live = new Set(generatedKeys);
  return storedKeys.filter((k) => !live.has(k));
}
