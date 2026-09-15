import type { PartitionRow } from "./types";

interface PartitionPreviewProps {
  partition: PartitionRow;
}

/**
 * S21-A3: To-scale partition preview swatch for the left rail.
 *
 * Renders each panel as a proportional flex segment (flexBasis = panel.widthMm
 * / totalWidth * 100%) with a door-notch overlay when panel.door is set —
 * mirrors design-step-poc.html's makePartitionPreview().
 *
 * The collection route (GET /partitions?roomId=) returns the full Prisma row
 * including the `design` JSONB, so `partition.design?.panels` is always
 * available for expanded rooms (fetched by room-list.tsx).
 *
 * Falls back to a flat-colour rectangle for newly-created partitions that
 * have no panels yet (zero-panel edge case).
 */
export function PartitionPreview({ partition }: PartitionPreviewProps) {
  const panels = partition.design?.panels ?? [];

  if (panels.length === 0) {
    // No panels yet (new partition, empty design) — flat-colour fallback.
    return (
      <div
        className="mt-1 h-[38px] w-full overflow-hidden rounded-[3px] border border-border bg-bg-white"
        aria-hidden="true"
      />
    );
  }

  const totalWidth = panels.reduce((s, p) => s + p.widthMm, 0) || 1;

  return (
    <div
      className="mt-1 flex h-[38px] w-full overflow-hidden rounded-[3px] border-[1.5px] border-border bg-bg-white"
      aria-hidden="true"
    >
      {panels.map((panel) => (
        <div
          key={panel.id}
          className="relative shrink-0 border-r border-[rgba(27,40,30,.14)] last:border-r-0"
          style={{ flexBasis: `${(panel.widthMm / totalWidth) * 100}%` }}
        >
          {panel.door && (
            /* Door notch — matches .preview-door in the mockup CSS */
            <div
              className="absolute bottom-0 left-[16%] right-[16%] top-[22%] rounded-t-[2px] border border-[rgba(27,40,30,.22)] border-b-0 bg-white/65"
              aria-hidden="true"
            />
          )}
        </div>
      ))}
    </div>
  );
}
