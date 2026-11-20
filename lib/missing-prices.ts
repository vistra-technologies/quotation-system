/** A material-list item with no price for the project currency. */
export type MissingPrice = { code: string; name: string };

/**
 * Items of a material list whose code has no price row in the project currency.
 * `pricedCodes` is the set of inventory codes that have a price in that currency.
 * Deduped by code (first name wins), in first-seen order. Pure, Prisma-free.
 */
export function findMissingPrices(
  items: ReadonlyArray<{ code: string; name: string }>,
  pricedCodes: ReadonlySet<string>,
): MissingPrice[] {
  const seen = new Set<string>();
  const out: MissingPrice[] = [];
  for (const it of items) {
    if (pricedCodes.has(it.code) || seen.has(it.code)) continue;
    seen.add(it.code);
    out.push({ code: it.code, name: it.name });
  }
  return out;
}
