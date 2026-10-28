/**
 * Re-export from the shared lib location (moved Stage 34 D-49).
 * Quick Estimate popup and Design canvas dimension inputs both use these guards.
 */
export {
  isPlainNonNegativeNumber,
  blockNumericKeys,
  sanitizeNumericPaste,
  numericInputGuards,
} from "@/lib/numeric-input";
