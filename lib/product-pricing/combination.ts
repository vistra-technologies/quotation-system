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

/** Max chars of a stored key (S36-8). */
export const MAX_KEY_LENGTH = 1000;
export const MAX_KEY_FIELDS = 20;
export const MAX_LABEL_LENGTH = 300;

/**
 * S36-6: the label is the chosen values in schema order joined by the Quick Estimate variant separator, so it
 * equals the variant text. `fieldKeys` is the spec field order; a key with no value is skipped.
 */
export function combinationLabel(
  fieldKeys: readonly string[],
  valuesByKey: Record<string, string>,
  separator: string,
): string {
  return fieldKeys.filter((k) => valuesByKey[k] !== undefined).map((k) => valuesByKey[k]).join(separator);
}

/**
 * S36-8: a stored key must parse to a flat object of non-empty string values (at most 20 keys), be at most
 * 1,000 chars, and equal its own canonical (sorted-key) re-serialisation. It is deliberately NOT checked
 * against the current catalog: an orphaned row stays editable (PP-25). Returns an error message or null.
 */
export function validateCombinationKey(key: unknown): string | null {
  if (typeof key !== "string") return "combinationKey must be a string";
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
    return `combinationKey must be 1 to ${MAX_KEY_LENGTH} characters`;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return "combinationKey must be valid JSON";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "combinationKey must be a JSON object";
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) return "combinationKey must have at least one field";
  if (entries.length > MAX_KEY_FIELDS) return `combinationKey may have at most ${MAX_KEY_FIELDS} fields`;
  for (const [, v] of entries) {
    if (typeof v !== "string" || v === "") return "combinationKey values must be non-empty strings";
  }
  if (combinationKey(parsed as Record<string, string>) !== key) {
    return "combinationKey must be canonical (keys sorted, no extra whitespace)";
  }
  return null;
}

/** S36-8: label trimmed, 1 to 300 chars. Returns the trimmed label or an error. */
export function validateCombinationLabel(label: unknown): { ok: true; label: string } | { ok: false; error: string } {
  if (typeof label !== "string") return { ok: false, error: "combinationLabel must be a string" };
  const t = label.trim();
  if (t.length < 1 || t.length > MAX_LABEL_LENGTH) {
    return { ok: false, error: `combinationLabel must be 1 to ${MAX_LABEL_LENGTH} characters` };
  }
  return { ok: true, label: t };
}
