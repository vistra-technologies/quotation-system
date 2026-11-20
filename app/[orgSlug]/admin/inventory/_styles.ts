/**
 * Class vocabulary lifted verbatim from mockup A rev 7 (`design-docs/mockups/inventory-page-2026-11-19/`, the `C`
 * object). The mockup frame was a container, so its `@min-[1440px]` is the plain `min-[1440px]` here.
 */
export const C = {
  th: "whitespace-nowrap border-b border-border px-3.5 py-2.5 text-left text-[11.5px] font-extrabold tracking-[.03em] text-text-muted",
  td: "border-b border-border px-3.5 py-[11px] align-middle text-[13px] text-text-body",
  btnP: "inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-primary-dark bg-primary px-3.5 text-[13px] font-bold text-white hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
  btnS: "inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-border-strong bg-bg-white px-3.5 text-[13px] font-bold text-text-body hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
  icon: "flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border text-text-muted hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
  chip: "flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-bold hover:border-border-strong hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
  chipOn: "border-primary-soft bg-primary-softer text-primary-dark",
  chipOff: "border-border bg-bg-white text-text-muted",
  label: "text-xs font-extrabold text-text-heading",
  sectionH: "text-[11px] font-extrabold uppercase tracking-[.06em] text-text-muted",
  input:
    "h-[34px] w-full rounded-sm border px-3 text-sm text-text-heading outline-none focus:border-primary focus:shadow-[0_0_0_2px_rgba(78,127,88,.15)]",
  inOk: "border-border bg-bg-white",
  inErr: "border-[var(--color-danger-border)] bg-[#FFF5F5]",
  err: "mt-1 text-xs font-bold text-[var(--color-status-failed-text)]",
} as const;

export const ACTIVE_BADGE =
  "inline-flex items-center rounded-full bg-status-paid-bg px-2.5 py-0.5 text-[11px] font-extrabold text-status-paid-text";
export const INACTIVE_BADGE =
  "inline-flex items-center rounded-full bg-status-refunded-bg px-2.5 py-0.5 text-[11px] font-extrabold text-status-refunded-text";
export const UNASSIGNED_BADGE =
  "inline-flex items-center rounded-full border border-status-pending-border bg-status-pending-bg px-2 py-px text-[11px] font-extrabold text-status-pending-text";
