/**
 * Formula-mismatch indicator chip.
 *
 * Renders an amber warning badge when `show` is true (the org's assigned formula set
 * references ComponentType codes or field keys that are missing/inactive in this org).
 *
 * Computed on read (not stored) — used on the org list and the org edit page.
 *
 * Stage 25 Batch 5 — org formula-set assignment.
 */
export function MismatchChip({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-pill border border-status-pending-border bg-status-pending-bg px-1.5 py-0.5 text-[11px] font-bold text-status-pending-text">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-2.5 w-2.5 flex-shrink-0"
        aria-hidden="true"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      Formula mismatch
    </span>
  );
}
