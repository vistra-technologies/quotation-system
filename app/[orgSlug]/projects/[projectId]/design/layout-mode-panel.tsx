"use client";

import { useTranslations } from "next-intl";
import { ConvertSideForm } from "./convert-side-form";
import { useUnit } from "./unit-context";
import type { PartitionRow, RoomRow } from "./types";

interface LayoutModePanelProps {
  orgSlug: string;
  isSubdomain: boolean;
  floorId: string;
  room: RoomRow;
  sideIndex: number;
  partitions: PartitionRow[];
  onCancel: () => void;
  onConverted: (room: RoomRow) => void;
  onConfigure: (partitionId: string, sideIndex: number) => void;
}

/**
 * Right-rail content when a side is selected on the floor-plan diagram —
 * mirrors design-step-poc.html's `renderWallDetails`: a convert-to-partition
 * form for a PLAIN side, or a summary + "Configure Partition →" for an
 * already-converted one.
 */
export function LayoutModePanel({
  orgSlug,
  isSubdomain,
  floorId,
  room,
  sideIndex,
  partitions,
  onCancel,
  onConverted,
  onConfigure,
}: LayoutModePanelProps) {
  const t = useTranslations("design");
  const { formatLen } = useUnit();
  const side = room.sides[sideIndex];

  if (side.kind === "PLAIN") {
    return (
      <ConvertSideForm
        orgSlug={orgSlug}
        isSubdomain={isSubdomain}
        floorId={floorId}
        roomId={room.id}
        sideIndex={sideIndex}
        onCancel={onCancel}
        onConverted={onConverted}
      />
    );
  }

  const partition = partitions.find((p) => p.id === side.partitionId);

  return (
    <div className="rounded-md border border-border bg-bg-card px-3.5 py-3.5">
      <h4 className="mb-2.5 text-xs font-bold text-text-heading">
        {t("partitionSummaryTitle")}
      </h4>
      {partition ? (
        <div className="mb-3 flex flex-col gap-1">
          <p className="text-xs font-bold text-text-heading">{partition.label}</p>
          <p className="text-xs text-text-muted">
            {formatLen(partition.widthMm)} {t("wide")} × {formatLen(partition.heightMm)} {t("tall")}
          </p>
        </div>
      ) : (
        <p className="mb-3 text-xs text-text-muted">{t("loadingPartition")}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onConfigure(side.partitionId, sideIndex)}
          className="flex-1 rounded-sm bg-primary px-2.5 py-1.5 text-xs font-bold text-text-on-primary hover:bg-primary-dark"
        >
          {t("configurePartition")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-sm border border-border px-2.5 py-1.5 text-xs text-text-body hover:bg-primary-softer"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
