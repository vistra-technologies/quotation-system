import type { ClipboardEvent, DragEvent, FormEvent, KeyboardEvent } from "react";

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

/**
 * Pure predicate for the `beforeinput` guard — extracted for unit testing.
 * Returns true when the insertion described by (inputType, data) should be blocked:
 *   - insertText:    block if `data` is one of the blocked chars (Android/IME path where
 *                   keydown reports key 'Unidentified'/229 and the actual char arrives here).
 *   - insertFromDrop: block if the dropped text is not a plain non-negative number.
 */
export function isBlockedBeforeInput(inputType: string, data: string | null): boolean {
  if (inputType === "insertText") return data != null && BLOCKED_KEYS.has(data);
  if (inputType === "insertFromDrop") return !isPlainNonNegativeNumber(data ?? "");
  return false;
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

/**
 * Blocks single blocked chars ("-", "+", "e", "E") arriving via Android/IME
 * (where `keydown` reports key "Unidentified"/229 and `beforeinput.data` carries the real char).
 * Also blocks insertFromDrop when the dropped text is not a plain non-negative number.
 */
export function blockNumericBeforeInput(e: FormEvent<HTMLInputElement>): void {
  const ie = e.nativeEvent as InputEvent;
  if (isBlockedBeforeInput(ie.inputType, ie.data)) e.preventDefault();
}

/**
 * Prevents a drag-drop of text that is not a plain non-negative number into the field.
 * Allows valid drops (e.g. "1400") through so the browser inserts them normally.
 */
export function blockNumericDrop(e: DragEvent<HTMLInputElement>): void {
  const text = e.dataTransfer.getData("text/plain");
  if (!isPlainNonNegativeNumber(text)) e.preventDefault();
}

/** Spread onto each numeric `<input>` to guard all common insertion paths. */
export const numericInputGuards = {
  onKeyDown: blockNumericKeys,
  onPaste: sanitizeNumericPaste,
  onBeforeInput: blockNumericBeforeInput,
  onDrop: blockNumericDrop,
};
