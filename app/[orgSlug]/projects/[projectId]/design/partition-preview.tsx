import type { PartitionRow } from "./types";

interface PartitionPreviewProps {
  partition: PartitionRow;
}

/**
 * Small to-scale preview swatch for a converted (PARTITION) side, shown in
 * the left rail under each partition row — mirrors design-step-poc.html's
 * `.partition-preview` (a rectangular, to-scale glass-fill swatch).
 *
 * Still a simplified stub as of Piece 3 (review-item7-piece2-round2.md
 * MINOR 9 — re-labelled here since Piece 2 shipped Configure mode's real
 * panel/door canvas primitives (`wall-canvas.tsx`), so this comment's
 * original "isn't fetched until Piece 2" framing is now stale): the
 * `PartitionRow` type this component receives (types.ts) doesn't carry
 * `design`, only `label`/`heightMm`/`widthMm` — the collection route
 * (`GET /partitions?roomId=`) that feeds the room list deliberately never
 * returns the `design` JSONB (see by-page.sql's note on that route), so a
 * real per-panel/door swatch here would need either a second fetch per
 * expanded partition or a route-shape change, neither of which Piece 3's
 * polish scope covers. Deliberate, not forgotten — flag again if a future
 * pass revisits the left-rail preview's fidelity. Renders one flat-colour
 * rectangle sized to the partition's own width:height aspect ratio —
 * non-interactive, no panel subdivision.
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
