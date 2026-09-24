"use client";

/**
 * Summary page action row (Stage 26 Batch 2) — Recompute + Export PDF buttons, matching the
 * signed-off `mockup-batch0.html` section 1 (idle / not-DRAFT+tooltip states) translated to the
 * app's Tailwind tokens.
 *
 * Both buttons are inert in this batch (no `onClick`, no loading state) — Batch 3 wires Recompute's
 * click/fetch/popup behavior and its "Recomputing…" spinner state onto this same file; Batch 4 wires
 * Export's real PDF generation. This file only owns the button *shape* (outline vs primary, icon,
 * disabled+tooltip vs enabled, row placement/order) — already approved at Batch 0 sign-off.
 */
interface ActionRowProps {
  /** Gates Recompute per S26-8 — disabled+tooltip when the project is not DRAFT. */
  isDraft: boolean;
  /** False on the FAILED-row page state (no KPI/Material data to export). */
  showExport: boolean;
}

export function ActionRow({ isDraft, showExport }: ActionRowProps) {
  return (
    <div className="mb-4 flex items-center justify-end gap-2.5">
      <div className="group relative inline-flex">
        {!isDraft && (
          <div className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-md bg-text-heading px-2.5 py-1.5 text-[11.5px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
            Recompute is only available while the project is in Draft
          </div>
        )}
        <button
          type="button"
          disabled={!isDraft}
          className="inline-flex items-center gap-2 rounded-sm border border-border bg-bg-white px-4 py-2 text-[13px] font-bold text-text-body hover:bg-primary-softer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-bg-white"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-[15px] w-[15px]"
            aria-hidden="true"
          >
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span>Recompute</span>
        </button>
      </div>

      {showExport && (
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-[13px] font-bold text-text-on-primary hover:bg-primary-dark"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-[15px] w-[15px]"
            aria-hidden="true"
          >
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
          <span>Export PDF</span>
        </button>
      )}
    </div>
  );
}
