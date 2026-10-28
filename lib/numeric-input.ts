import type { ClipboardEvent, KeyboardEvent } from "react";

/**
 * Shared guards for `type="number"` inputs across the app (Quick Estimate popup and
 * Design canvas dimension fields). `type="number" min={0}` does not stop "-", "+",
 * "e" or "E" being typed or pasted; these handlers do. The server already rejects
 * negatives; this keeps the fields clean. Pure helpers, no state.
 *
 * Moved from `app/[orgSlug]/quick-estimate/numeric-input.ts` (Stage 34 D-49).
 */
const BLOCKED_KEYS = new Set(["-", "+", "e", "E"]);

/** A plain non-negative decimal: digits with an optional fraction ("5", "5.", ".5", "12.50"). No sign, no exponent. */
export function isPlainNonNegativeNumber(text: string): boolean {
  return /^(\d+\.?\d*|\.\d+)$/.test(text);
}

export function blockNumericKeys(e: KeyboardEvent<HTMLInputElement>): void {
  // Ctrl/Meta/Alt chords (browser zoom with Ctrl+"-" / Ctrl+"+", Ctrl+E) must keep working.
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (BLOCKED_KEYS.has(e.key)) e.preventDefault();
}

/** Rejects a paste that is not a plain non-negative number; the field stays unchanged. */
export function sanitizeNumericPaste(e: ClipboardEvent<HTMLInputElement>): void {
  if (!isPlainNonNegativeNumber(e.clipboardData.getData("text"))) e.preventDefault();
}

/** Spread onto each numeric `<input>`. */
export const numericInputGuards = {
  onKeyDown: blockNumericKeys,
  onPaste: sanitizeNumericPaste,
};
