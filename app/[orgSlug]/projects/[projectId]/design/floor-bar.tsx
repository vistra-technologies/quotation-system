"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { redirectToLogin } from "./login-redirect";
import { SelectField } from "@/components/select-field";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TrashIcon } from "@/components/trash-icon";
import type { FloorRow } from "./types";

interface FloorBarProps {
  orgSlug: string;
  projectId: string;
  isSubdomain: boolean;
  floors: FloorRow[];
  selectedFloorId: string | null;
  onSelectFloor: (floorId: string) => void;
  onFloorCreated: (floor: FloorRow) => void;
  /**
   * Optional — called after a successful rename so the parent
   * (design-workspace.tsx) can sync its own floor list. design-workspace.tsx
   * wires this (see its `onFloorRenamed={handleFloorRenamed}` call); kept
   * optional so FloorBar's own local-label update still works standalone
   * (e.g. in isolation/tests) if a caller doesn't pass it.
   */
  onFloorRenamed?: (floor: FloorRow) => void;
  /**
   * Optional — called after a successful delete so the parent can remove the
   * floor from its list. design-workspace.tsx wires this (see its
   * `onFloorDeleted={handleFloorDeleted}` call); kept optional for the same
   * reason as onFloorRenamed above.
   */
  onFloorDeleted?: (floorId: string) => void;
}

/**
 * S21-A1: Floor picker + inline add/rename/delete — mirrors
 * design-step-poc.html's renderFloorBar.
 *
 * Three UI states:
 *   1. Normal: SelectField + rename (✎) + delete (🗑) icon buttons + add (＋) button.
 *   2. Adding: inline form (input + Add + ✕).
 *   3. Renaming: inline form (input + Save + ✕).
 * Delete uses a ConfirmDialog.
 *
 * Local state management: FloorBar maintains its own derived display list
 * (deletedFloorIds + renamedLabels) so renames/deletes are immediately visible
 * in the dropdown without waiting for design-workspace.tsx (frozen) to re-sync.
 * When onFloorRenamed/onFloorDeleted are provided, the parent state is also
 * updated. When they are not (current frozen setup), only the local display
 * updates — the workspace.tsx floor-label breadcrumb in the center header may
 * show a stale name until the page reloads. This is a known cosmetic limitation
 * of the frozen-workspace constraint.
 */
export function FloorBar({
  orgSlug,
  projectId,
  isSubdomain,
  floors,
  selectedFloorId,
  onSelectFloor,
  onFloorCreated,
  onFloorRenamed,
  onFloorDeleted,
}: FloorBarProps) {
  const t = useTranslations("design");

  // ── Local display overrides (work around frozen workspace.tsx) ────────────
  // Renamed labels: floorId → new label.
  const [renamedLabels, setRenamedLabels] = useState<Record<string, string>>({});
  // Deleted floor ids: hidden from the SelectField dropdown.
  const [deletedFloorIds, setDeletedFloorIds] = useState<Set<string>>(new Set());

  // ── Form states ───────────────────────────────────────────────────────────
  const [mode, setMode] = useState<"normal" | "adding" | "renaming">("normal");
  const [inputValue, setInputValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // ── Derived display list ──────────────────────────────────────────────────
  const visibleFloors = floors
    .filter((f) => !deletedFloorIds.has(f.id))
    .map((f) => ({ ...f, label: renamedLabels[f.id] ?? f.label }));

  const currentFloor = visibleFloors.find((f) => f.id === selectedFloorId) ?? null;

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function submitAdd() {
    const label = inputValue.trim();
    if (!label) { setError("Floor name cannot be empty."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/floors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, label }),
      });
      if (res.status === 401 || res.status === 403) { redirectToLogin(orgSlug, isSubdomain); return; }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to add floor — please try again.");
        return;
      }
      const { floor } = (await res.json()) as { floor: FloorRow };
      onFloorCreated(floor);
      setMode("normal");
      setInputValue("");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRename() {
    if (!selectedFloorId) return;
    const label = inputValue.trim();
    if (!label) { setError("Floor name cannot be empty."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/floors/${selectedFloorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (res.status === 401 || res.status === 403) { redirectToLogin(orgSlug, isSubdomain); return; }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to rename floor — please try again.");
        return;
      }
      const { floor } = (await res.json()) as { floor: FloorRow };
      // Update local display override.
      setRenamedLabels((prev) => ({ ...prev, [floor.id]: floor.label }));
      onFloorRenamed?.(floor);
      setMode("normal");
      setInputValue("");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    if (!selectedFloorId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/floors/${selectedFloorId}`, {
        method: "DELETE",
      });
      if (res.status === 401 || res.status === 403) { redirectToLogin(orgSlug, isSubdomain); return; }
      if (!res.ok) {
        setError("Failed to delete floor — please try again.");
        setConfirmingDelete(false);
        return;
      }
      // Hide locally.
      setDeletedFloorIds((prev) => new Set([...prev, selectedFloorId]));
      onFloorDeleted?.(selectedFloorId);
      setConfirmingDelete(false);
      // Select a remaining floor (or none).
      const remaining = visibleFloors.filter((f) => f.id !== selectedFloorId);
      if (remaining.length > 0) {
        onSelectFloor(remaining[0].id);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function cancelMode() {
    setMode("normal");
    setInputValue("");
    setError(null);
  }

  // ── Render: adding or renaming (inline form) ──────────────────────────────

  if (mode === "adding" || mode === "renaming") {
    const isAdding = mode === "adding";
    return (
      <div className="mb-3 flex flex-col gap-1">
        {error && <p className="text-[11px] text-red-700">{error}</p>}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            autoFocus
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void (isAdding ? submitAdd() : submitRename());
              else if (e.key === "Escape") cancelMode();
            }}
            placeholder={t("floorNamePlaceholder")}
            className="min-w-0 flex-1 rounded-sm border border-primary-soft bg-bg-white px-2.5 py-1.5 text-[12.5px] font-bold text-text-heading placeholder:text-text-placeholder focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void (isAdding ? submitAdd() : submitRename())}
            disabled={submitting}
            className="shrink-0 rounded-sm bg-primary px-2.5 py-1.5 text-[11.5px] font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
          >
            {isAdding ? t("addFloorSubmit") : t("renameFloorSubmit")}
          </button>
          <button
            type="button"
            onClick={cancelMode}
            className="shrink-0 rounded-sm border border-border bg-bg-white px-2 py-1.5 text-[11.5px] text-text-body hover:border-[#b9c2ae]"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  // ── Render: normal (SelectField + icon buttons) ───────────────────────────

  // Delete is allowed down to zero floors — the project can end up with none,
  // matching the human's call on bug #9 (previously blocked at 1 remaining).
  // Rename and the dropdown itself only need a floor to act on at all.
  const hasFloors = visibleFloors.length > 0;

  return (
    <>
      <div className="mb-3 flex items-center gap-1.5">
        {/* Floor selector — min-w-0/flex-1 on the wrapper div (not on SelectField itself)
            so the trigger inherits the flex sizing of this row correctly. */}
        <div className="min-w-0 flex-1">
          <SelectField
            value={selectedFloorId ?? ""}
            onChange={(e) => onSelectFloor(e.target.value)}
            title={currentFloor?.label ?? ""}
            disabled={!hasFloors}
            className="w-full truncate rounded-sm border border-border bg-bg-white px-2 py-1.5 text-[12.5px] font-bold text-text-heading focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {visibleFloors.map((f) => (
              <option key={f.id} value={f.id} title={f.label}>
                {f.label}
              </option>
            ))}
          </SelectField>
        </div>

        {/* Rename icon button (✎) — disabled when there's no floor to rename */}
        <button
          type="button"
          title={t("renameFloor")}
          disabled={!hasFloors}
          onClick={() => {
            setInputValue(currentFloor?.label ?? "");
            setMode("renaming");
            setError(null);
          }}
          className={[
            "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm border text-[12px]",
            hasFloors
              ? "border-border bg-bg-white text-text-body hover:border-primary hover:text-primary-dark"
              : "cursor-not-allowed border-border bg-bg-white text-text-placeholder opacity-40",
          ].join(" ")}
        >
          ✎
        </button>

        {/* Delete icon button — disabled only when there's no floor to delete */}
        <button
          type="button"
          title={t("deleteFloor")}
          disabled={!hasFloors}
          onClick={() => setConfirmingDelete(true)}
          className={[
            "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm border transition-colors",
            hasFloors
              ? "border-border bg-bg-white text-text-body hover:border-[var(--color-danger-border)] hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-status-failed-text)]"
              : "cursor-not-allowed border-border bg-bg-white text-text-placeholder opacity-40",
          ].join(" ")}
        >
          <TrashIcon />
        </button>

        {/* Add-floor button (＋) */}
        <button
          type="button"
          title={t("addFloor")}
          onClick={() => {
            setInputValue(`Floor ${visibleFloors.length + 1}`);
            setMode("adding");
            setError(null);
          }}
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm border border-primary-soft bg-primary-softer text-[14px] font-bold text-primary-dark hover:border-primary"
        >
          ＋
        </button>
      </div>

      {error && <p className="mb-1 text-[11px] text-red-700">{error}</p>}

      {/* Delete-floor confirm dialog */}
      <ConfirmDialog
        isOpen={confirmingDelete}
        title={t("deleteFloorConfirmTitle")}
        message={t("deleteFloorConfirmMsg", { name: currentFloor?.label ?? "" })}
        confirmLabel={t("confirmDelete")}
        confirmVariant="danger"
        cancelLabel={t("cancel")}
        onConfirm={() => void confirmDelete()}
        onCancel={() => { setConfirmingDelete(false); setError(null); }}
      />
    </>
  );
}
