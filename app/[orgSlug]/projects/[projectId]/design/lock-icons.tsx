/**
 * Small inline SVG icons for the Stage 34 lock UI (mockup v7: LOCK_SVG / UNLOCK_SVG / TICK_SVG).
 * Pure presentational, no i18n, safe in any client tree.
 */

const common = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function LockIcon({ size = 13 }: { size?: number }) {
  return (
    <svg {...common} width={size} height={size} strokeWidth={2.2}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function UnlockIcon({ size = 13 }: { size?: number }) {
  return (
    <svg {...common} width={size} height={size} strokeWidth={2.2}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.6-1.8" />
    </svg>
  );
}

export function TickIcon({ size = 13 }: { size?: number }) {
  return (
    <svg {...common} width={size} height={size} strokeWidth={3}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
