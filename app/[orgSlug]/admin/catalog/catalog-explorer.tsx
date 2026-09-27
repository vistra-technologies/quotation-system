"use client";

import { useState } from "react";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { choiceFields, emptyGroups, isChain, sync } from "./catalog-model";
import { SegmentTabs } from "./segment-tabs";
import { CatalogTree } from "./catalog-tree";
import { AttributeEditorModal } from "./attribute-editor-modal";
import { Toast, useToast } from "@/components/toast";

export interface CatalogComponentType {
  id: string;
  code: string;
  name: string;
  fieldsSchema: FieldEntry[];
  fieldOptionsConfig: FieldOptionsConfig;
}

interface CatalogExplorerProps {
  orgSlug: string;
  componentTypes: CatalogComponentType[];
}

/**
 * Top-level Catalog page orchestrator — Stage 27.
 *
 * Owns the last-*saved* config per segment (`configsByType`, the direct equivalent of the
 * mockup's `DATA` object — only ever updated after a successful PUT), which segment is active,
 * the search query, and which attribute's editor modal is open. Fetches nothing itself — every
 * ComponentType's `fieldsSchema` + `fieldOptionsConfig` already arrived via `page.tsx` props.
 */
export function CatalogExplorer({ orgSlug, componentTypes }: CatalogExplorerProps) {
  const [configsByType, setConfigsByType] = useState<Record<string, FieldOptionsConfig>>(() => {
    const init: Record<string, FieldOptionsConfig> = {};
    for (const ct of componentTypes) {
      init[ct.id] = sync(ct.fieldsSchema, ct.fieldOptionsConfig);
    }
    return init;
  });
  const [activeTypeId, setActiveTypeId] = useState(componentTypes[0]?.id ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [openAttr, setOpenAttr] = useState<{ typeId: string; fieldKey: string } | null>(null);
  const toast = useToast();

  const active = componentTypes.find((ct) => ct.id === activeTypeId);

  function handleSaved(typeId: string, newConfig: FieldOptionsConfig, savedLabel: string) {
    setConfigsByType((prev) => ({ ...prev, [typeId]: newConfig }));
    toast.show(`${savedLabel} saved`);
  }

  if (!active) return null;

  const activeFields = choiceFields(active.fieldsSchema);
  const activeConfig = configsByType[active.id] ?? {};
  const chainCount = activeFields.filter((f) => isChain(activeFields, f)).length;
  const warnCount = activeFields.filter((f) => emptyGroups(activeFields, activeConfig, f).length > 0).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentTabs
          segments={componentTypes.map((ct) => ({
            typeId: ct.id,
            code: ct.code,
            name: ct.name,
            fieldsSchema: ct.fieldsSchema,
            config: configsByType[ct.id] ?? {},
          }))}
          activeTypeId={activeTypeId}
          searchQuery={searchQuery}
          onSelect={setActiveTypeId}
        />
        <div className="flex-1" />
        <div className="relative w-[300px] max-w-full">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Find an attribute or value…"
            autoComplete="off"
            className="w-full rounded-sm border border-border bg-bg-white py-2.5 pl-3 pr-3 text-[13px] text-text-body focus:border-primary-soft focus:outline-none focus:ring-3 focus:ring-primary-softer"
          />
        </div>
      </div>

      <section aria-label="Catalog dependency tree" className="overflow-hidden rounded-md border border-border bg-bg-card shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-bg-white px-5.5 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-extrabold text-text-heading">
              {active.name} <span className="text-text-muted">({active.code})</span>
            </h2>
            <div className="flex flex-wrap gap-1.5">
              <span className="whitespace-nowrap rounded-pill bg-primary-softer px-2.5 py-1 text-[11.5px] font-bold text-primary-dark">
                {chainCount} in dependency chain
              </span>
              <span className="whitespace-nowrap rounded-pill bg-primary-softer px-2.5 py-1 text-[11.5px] font-bold text-primary-dark">
                {activeFields.length - chainCount} independent
              </span>
              {warnCount > 0 && (
                <span className="whitespace-nowrap rounded-pill bg-status-pending-bg px-2.5 py-1 text-[11.5px] font-bold text-status-pending-text">
                  {warnCount} need options
                </span>
              )}
            </div>
          </div>
        </div>
        <CatalogTree
          segmentName={active.name}
          segmentCode={active.code}
          fieldsSchema={active.fieldsSchema}
          config={activeConfig}
          searchQuery={searchQuery}
          onOpenAttr={(fieldKey) => setOpenAttr({ typeId: active.id, fieldKey })}
        />
      </section>

      {openAttr && (
        <AttributeEditorModal
          orgSlug={orgSlug}
          typeId={openAttr.typeId}
          fieldsSchema={componentTypes.find((ct) => ct.id === openAttr.typeId)?.fieldsSchema ?? []}
          savedConfig={configsByType[openAttr.typeId] ?? {}}
          openFieldKey={openAttr.fieldKey}
          onClose={() => setOpenAttr(null)}
          onSaved={(newConfig, label) => {
            handleSaved(openAttr.typeId, newConfig, label);
            setOpenAttr(null);
          }}
        />
      )}

      <Toast {...toast} />
    </div>
  );
}
