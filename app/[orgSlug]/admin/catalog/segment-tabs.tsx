"use client";

import { attrMatches, choiceFields } from "./catalog-model";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";

export interface SegmentTabInfo {
  typeId: string;
  code: string;
  name: string;
  fieldsSchema: FieldEntry[];
  config: FieldOptionsConfig;
}

interface SegmentTabsProps {
  segments: SegmentTabInfo[];
  activeTypeId: string;
  searchQuery: string;
  onSelect: (typeId: string) => void;
}

/**
 * The `seg-tabs` bar — one tab per ComponentType ("segment"): icon, name + code, attribute count,
 * and (for an inactive tab with a search in progress) a match-count badge. Presentational, no
 * state of its own — ported from the mockup's `renderTabs`.
 *
 * S27-3: attribute count only, no option-count total.
 */
export function SegmentTabs({ segments, activeTypeId, searchQuery, onSelect }: SegmentTabsProps) {
  const q = searchQuery.trim().toLowerCase();

  return (
    <div className="flex flex-wrap gap-2.5" role="tablist" aria-label="Catalog segments">
      {segments.map((seg) => {
        const fields = choiceFields(seg.fieldsSchema);
        const active = seg.typeId === activeTypeId;
        const hits = q ? fields.filter((f) => attrMatches(fields, seg.config, f, q)).length : 0;

        return (
          <button
            key={seg.typeId}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(seg.typeId)}
            className={`relative flex items-center gap-2.5 rounded-xl border bg-bg-white py-2.5 pl-2.5 pr-4.5 text-left transition ${
              active
                ? "border-primary shadow-[0_0_0_3px_var(--color-primary-softer)]"
                : "border-border hover:border-primary-soft hover:bg-bg-card"
            }`}
          >
            <span
              className={`flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] ${
                active ? "bg-primary text-text-on-primary" : "bg-primary-softer text-primary-dark"
              }`}
            />
            <span className="flex flex-col">
              <span className="text-[14.5px] font-extrabold text-text-heading">
                {seg.name} <span className="text-text-muted">({seg.code})</span>
              </span>
              <span className="mt-px text-[11.5px] font-semibold text-text-muted">
                {fields.length} attribute{fields.length === 1 ? "" : "s"}
              </span>
            </span>
            {!active && hits > 0 && (
              <span
                title={`${hits} match${hits === 1 ? "" : "es"} in this segment`}
                className="absolute -right-2 -top-2 flex h-[21px] min-w-[21px] items-center justify-center rounded-pill border-2 border-bg-page bg-status-pending-bg px-1.5 text-[11px] font-extrabold text-status-pending-text"
              >
                {hits}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
