/**
 * Seat pill: `used/limit`, amber at the cap (Stage 29 mockup).
 *
 * Pure markup, usable from Server and Client Components. `limit` is omitted until Batch 2 puts
 * `Organization.userLimit` on the wire; the pill then shows an em dash and is never amber.
 */
export function SeatPill({
  used,
  limit,
  small = false,
}: {
  used: number;
  limit?: number | null;
  small?: boolean;
}) {
  const atCap = typeof limit === "number" && used >= limit;
  const tone = atCap
    ? "bg-status-pending-bg text-status-pending-text"
    : "bg-primary-softer text-primary-dark";
  const size = small ? "px-[7px] py-px text-[11px]" : "px-2.5 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-pill font-bold tabular-nums ${tone} ${size}`}
      title={typeof limit === "number" ? `${used} of ${limit} users` : `${used} users`}
    >
      {used}/{typeof limit === "number" ? limit : "—"}
    </span>
  );
}
