import type { PartitionRow } from "./types";

interface PartitionPreviewProps {
  partition: PartitionRow;
}

/**
 * Small to-scale preview swatch for a converted (PARTITION) side, shown in
 * the left rail under each partition row — mirrors design-step-poc.html's
 * `.partition-preview` (a rectangular, to-scale glass-fill swatch).
 *
 * Simplified stub for this piece (plan-item7.md Piece 1 scope note): full
 * per-panel/door rendering needs Configure mode's canvas primitives
 * (`Partition.design`'s panels[]/door shape), which isn't fetched or edited
 * until Piece 2. This renders one flat-colour rectangle sized to the
 * partition's own width:height aspect ratio — non-interactive, no panel
 * subdivision yet.
 */
export function PartitionPreview({ partition }: PartitionPreviewProps) {
  const aspect = partition.widthMm > 0 && partition.heightMm > 0
    ? partition.widthMm / partition.heightMm
    : 3;

  return (
    <div
      className="mt-1 flex h-9 w-full items-center justify-center overflow-hidden rounded-[3px] border border-border bg-bg-white"
      aria-hidden="true"
    >
      <div
        className="h-full bg-primary-soft"
        style={{ aspectRatio: aspect, maxWidth: "100%" }}
      />
    </div>
  );
}
