/**
 * Stage 36 (PP-6): the deterministic identity of one product combination. The key is the chosen value of every
 * visible product spec field as JSON with keys sorted, so it does not depend on field order or on how the
 * values object was built. Pure; shared by the generator tests now and by the pricing API and Quick Estimate later.
 */
export function combinationKey(valuesByKey: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(valuesByKey).sort()) sorted[k] = valuesByKey[k];
  return JSON.stringify(sorted);
}
