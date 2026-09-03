/**
 * Component type icon lookup — `code → outlined SVG icon`.
 *
 * Maps ComponentType.code to a hand-picked outlined SVG element.
 * Each icon uses a 24×24 viewBox, stroke="currentColor", strokeWidth="1.8",
 * strokeLinecap="round", strokeLinejoin="round", fill="none" — matching the
 * app's existing outline icon language (controls-shell.tsx nav icons, sidebar.tsx).
 *
 * Recognized codes: GLASS, DOOR, PROFILE_STOP.
 * Any other/unknown code falls back to the generic box/package outline icon
 * already used in add-selection-form.tsx's empty state (same SVG paths).
 *
 * Used in:
 *   - Configuration page sidebar ComponentType tiles
 *   - Configuration page Saved Components list rows
 */

interface IconProps {
  className?: string;
}

// ─── Per-code icons ──────────────────────────────────────────────────────────

/** GLASS — divided window pane (2×2 grid of glass panels). */
function GlassIcon({ className }: IconProps) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M12 3v18M3 12h18" />
    </svg>
  );
}

/** DOOR — rectangular door outline with a round handle. */
function DoorIcon({ className }: IconProps) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M5 2h14a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
      <circle cx="15" cy="12" r="1" />
    </svg>
  );
}

/** PROFILE_STOP — extruded stop-rail cross-section with tick marks. */
function ProfileStopIcon({ className }: IconProps) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* Outer bar representing the extruded profile cross-section */}
      <path d="M3 8h18a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      {/* Tick marks suggesting stop points along the rail */}
      <path d="M7 8v4M11 8v3M15 8v4M19 8v3" />
    </svg>
  );
}

/**
 * Fallback — generic box/package outline.
 * Identical to the SVG used in add-selection-form.tsx's empty state,
 * shared here rather than duplicated inline per the task spec.
 */
function FallbackIcon({ className }: IconProps) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
    </svg>
  );
}

// ─── Public export ───────────────────────────────────────────────────────────

/**
 * Returns an outlined SVG icon matched to the given ComponentType code.
 * Falls back to the generic box/package icon for unrecognized codes.
 *
 * @param code   ComponentType.code (e.g. "GLASS", "DOOR", "PROFILE_STOP")
 * @param className  Optional Tailwind class string forwarded to the SVG element
 */
export function ComponentIcon({
  code,
  className,
}: {
  code: string;
  className?: string;
}) {
  if (code === "GLASS") return <GlassIcon className={className} />;
  if (code === "DOOR") return <DoorIcon className={className} />;
  if (code === "PROFILE_STOP") return <ProfileStopIcon className={className} />;
  return <FallbackIcon className={className} />;
}
