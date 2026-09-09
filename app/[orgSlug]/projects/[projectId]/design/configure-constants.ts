/**
 * Configure mode's fixed real-world mm thresholds — mirrors
 * design-step-poc.html's fixed-inch constants (36in door-height min, 24in
 * default panel width, 16in split minimum), converted once to mm since
 * canonical storage is always mm. These are NOT display-unit conversions
 * (the mm/in/m toggle never touches them) — shared here so wall-canvas.tsx,
 * configure-mode.tsx, and saved-components-rail.tsx don't each duplicate the
 * same numbers.
 */

/** design-step-poc.html: `defH = Math.max(36, ...)` / slider `min="36"`. */
export const MIN_DOOR_HEIGHT_MM = 914; // 36in * 25.4

/** design-step-poc.html: `defH = Math.round(w.heightIn * 0.85)`. */
export const DEFAULT_DOOR_HEIGHT_RATIO = 0.85;

/** design-step-poc.html: `+ Add Panel` -> `widthIn: 24`. */
export const DEFAULT_PANEL_WIDTH_MM = 610; // 24in * 25.4, rounded

/** design-step-poc.html: split disabled when `widthIn < 16`. */
export const MIN_SPLIT_WIDTH_MM = 406; // 16in * 25.4, rounded
