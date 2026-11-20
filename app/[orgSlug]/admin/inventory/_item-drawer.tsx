"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  blankDraft,
  buildSavePayload,
  draftFromItem,
  isDirty,
  rowIssues,
  rowsToMatchObject,
  staleIssue,
  validateDraft,
} from "@/lib/inventory-draft";
import type { DraftRow, ItemDraft } from "@/lib/inventory-draft";
import { apiErrorMessage } from "@/lib/api-error-message";
import { alsoMatchedBy, partLabelOf } from "@/lib/inventory-list";
import type { ListItem, ListType } from "@/lib/inventory-list";
import { readMatchRows } from "@/lib/inventory-matches";
import { packLabel, unitSymbol } from "@/lib/units";
import { DrawerShell } from "./_drawer-shell";
import { ItemForm } from "./_item-form";
import { AlsoMatchedBy, DRow, InfoTip } from "./_parts";
import { ACTIVE_BADGE, C, INACTIVE_BADGE, UNASSIGNED_BADGE } from "./_styles";

/**
 * The Inventory item drawer (mockup A rev 7): read-only first with an Edit button, then the edit form
 * (Details + inline Matches rows). "New item" opens straight into the form. One Save is ONE request
 * (`buildSavePayload`). Closing with unsaved edits asks "Discard changes?" (Q-D29); changing the Component type
 * of an item that has a Part or Matches rows asks first, because both are cleared (S37-5).
 *
 * Where Stage 38a's Prices section will sit: below Matches. Nothing is rendered there and no price is shown.
 */

export type DrawerTarget = { kind: "item"; id: string } | { kind: "new" };

interface ItemDrawerProps {
  target: DrawerTarget;
  items: ListItem[];
  types: ListType[];
  orgSlug: string;
  onClose: () => void;
  /** Switch the drawer to another item ("Also matched by" links). */
  onOpenItem: (id: string) => void;
  /** After a successful save; the owner refreshes the list (and closes the drawer on create). */
  onSaved: (kind: "created" | "updated") => void;
  getRestoreTarget?: () => HTMLElement | null;
}

type Confirm = { kind: "discard"; then: () => void } | { kind: "type"; typeId: string } | null;

const CLOSE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export function InventoryItemDrawer({
  target,
  items,
  types,
  orgSlug,
  onClose,
  onOpenItem,
  onSaved,
  getRestoreTarget,
}: ItemDrawerProps) {
  const t = useTranslations("inventory");
  const titleId = useId();
  const isNew = target.kind === "new";
  const targetKey = target.kind === "item" ? target.id : "new";
  const item = target.kind === "item" ? (items.find((i) => i.id === target.id) ?? null) : null;
  const type = item?.componentTypeId ? types.find((x) => x.id === item.componentTypeId) : undefined;
  const original = useMemo<ItemDraft>(() => (item ? draftFromItem(item) : blankDraft()), [item]);

  const [mode, setMode] = useState<"view" | "edit">(isNew ? "edit" : "view");
  const [draft, setDraft] = useState<ItemDraft>(original);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [codeTaken, setCodeTaken] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [shownKey, setShownKey] = useState(targetKey);

  // The shell stays mounted when the drawer switches to another item, so the state resets here (not by remounting).
  if (shownKey !== targetKey) {
    setShownKey(targetKey);
    setMode(isNew ? "edit" : "view");
    setDraft(original);
    setAttempted(false);
    setSaving(false);
    setBanner(null);
    setCodeTaken(false);
    setConfirm(null);
  }

  const editing = mode === "edit";
  const formMode = isNew ? "create" : "edit";
  const draftType = types.find((x) => x.id === draft.componentTypeId);
  const dirty = editing && isDirty(original, draft);

  /** Run `action` now, or after the user confirms discarding unsaved edits. */
  function guard(action: () => void) {
    if (saving) return;
    if (dirty) setConfirm({ kind: "discard", then: action });
    else action();
  }
  function startEdit() {
    setDraft(original);
    setAttempted(false);
    setBanner(null);
    setCodeTaken(false);
    setMode("edit");
  }
  function cancelEdit() {
    guard(() => {
      setAttempted(false);
      setBanner(null);
      setMode("view");
    });
  }
  function patch(p: Partial<ItemDraft>) {
    if (p.code !== undefined) setCodeTaken(false);
    setDraft((d) => ({ ...d, ...p }));
  }
  function applyType(typeId: string) {
    setDraft((d) => ({ ...d, componentTypeId: typeId, partKey: null, rows: [] }));
  }
  function onTypeChange(typeId: string) {
    if (typeId === draft.componentTypeId) return;
    // S37-5: an existing item's Part and Matches rows are cleared on a type change, so ask first.
    if (!isNew && (draft.partKey !== null || draft.rows.length > 0)) setConfirm({ kind: "type", typeId });
    else applyType(typeId);
  }

  const validation = validateDraft(original, draft, draftType, formMode, types.length);
  const alsoMatched = alsoMatchedBy(
    { id: item?.id ?? "new", active: draft.active, componentTypeId: draft.componentTypeId || null },
    rowsToMatchObject(draft.rows, draftType),
    items,
  );

  async function save() {
    setAttempted(true);
    setBanner(null);
    setCodeTaken(false);
    if (!validation.ok || saving) return;
    const body = buildSavePayload(original, draft, draftType, formMode);
    const url = `/api/v1/orgs/${orgSlug}/inventory${item ? `/${item.id}` : ""}`;
    setSaving(true);
    try {
      const res = await fetch(url, {
        method: item ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        if (item) {
          setAttempted(false);
          setMode("view");
        }
        onSaved(item ? "updated" : "created");
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      setBanner(apiErrorMessage(data, t("saveFailed")));
      if (res.status === 409) setCodeTaken(true);
    } catch {
      setBanner(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DrawerShell
      titleId={titleId}
      onRequestClose={() => guard(onClose)}
      escapeBlocked={confirm !== null}
      getRestoreTarget={getRestoreTarget}
      overlay={
        <>
          <ConfirmDialog
            isOpen={confirm?.kind === "discard"}
            title={t("discardTitle")}
            message={t("discardBody")}
            confirmLabel={t("discardConfirm")}
            cancelLabel={t("discardKeep")}
            disableEscapeClose
            disableOverlayClose
            onConfirm={() => {
              const c = confirm;
              setConfirm(null);
              if (c?.kind === "discard") c.then();
            }}
            onCancel={() => setConfirm(null)}
          />
          <ConfirmDialog
            isOpen={confirm?.kind === "type"}
            title={t("typeChangeTitle")}
            message={t("typeChangeBody")}
            confirmLabel={t("typeChangeConfirm")}
            cancelLabel={t("cancel")}
            confirmVariant="primary"
            onConfirm={() => {
              const c = confirm;
              setConfirm(null);
              if (c?.kind === "type") applyType(c.typeId);
            }}
            onCancel={() => setConfirm(null)}
          />
        </>
      }
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-gradient-to-b from-bg-card to-bg-white px-5 py-4">
        {item ? (
          <div id={titleId} className="min-w-0">
            <div className="font-mono text-xs text-text-muted">{item.code}</div>
            <div className="mt-0.5 line-clamp-2 text-[15px] font-extrabold leading-snug text-text-heading">{item.name}</div>
            <div className="mt-1.5 flex gap-1.5">
              <span className={item.active ? ACTIVE_BADGE : INACTIVE_BADGE}>
                {item.active ? t("statusActive") : t("statusInactive")}
              </span>
            </div>
          </div>
        ) : (
          <span id={titleId} className="text-[15px] font-extrabold text-text-heading">
            {t("drawerNewTitle")}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {!editing ? (
            <button type="button" onClick={startEdit} className={`${C.btnS} h-8 px-3 text-xs`}>
              {t("edit")}
            </button>
          ) : null}
          <button type="button" onClick={() => guard(onClose)} aria-label={t("close")} className={C.icon}>
            {CLOSE_ICON}
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
        {editing ? (
          <ItemForm
            draft={draft}
            types={types}
            draftType={draftType}
            errors={attempted ? validation.fields : {}}
            codeTaken={codeTaken}
            showAllRowErrors={attempted}
            saving={saving}
            alsoMatched={alsoMatched}
            onPatch={patch}
            onTypeChange={onTypeChange}
            onRows={(rows: DraftRow[]) => patch({ rows })}
            onOpenItem={(id) => guard(() => onOpenItem(id))}
          />
        ) : item ? (
          <ItemView item={item} type={type} items={items} onOpenItem={(id) => guard(() => onOpenItem(id))} />
        ) : null}
        {/* Stage 38a: the Prices section sits here. No price is shown in Stage 37. */}
      </div>

      {editing ? (
        <>
          {banner ? (
            <div className="px-5 pb-3">
              <div
                role="alert"
                className="flex items-start gap-2 rounded-sm border border-danger-border bg-danger-bg px-3 py-2.5 text-xs font-semibold text-[var(--color-status-failed-text)]"
              >
                <span>{banner}</span>
              </div>
            </div>
          ) : null}
          <div className="flex shrink-0 gap-2 border-t border-border bg-bg-card px-5 py-3.5">
            <button type="button" disabled={saving} onClick={save} className={`${C.btnP} flex-1`}>
              {saving ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                  {t("saving")}
                </>
              ) : isNew ? (
                t("createItem")
              ) : (
                t("saveChanges")
              )}
            </button>
            <button type="button" disabled={saving} onClick={isNew ? () => guard(onClose) : cancelEdit} className={C.btnS}>
              {t("cancel")}
            </button>
          </div>
        </>
      ) : null}
    </DrawerShell>
  );
}

function ItemView({
  item,
  type,
  items,
  onOpenItem,
}: {
  item: ListItem;
  type: ListType | undefined;
  items: ListItem[];
  onOpenItem: (id: string) => void;
}) {
  const t = useTranslations("inventory");
  const rows = readMatchRows(item.attributes);
  const entries = Object.entries(rows);
  const issues = rowIssues(entries.map(([key, value]) => ({ key, value })), type);
  const part = partLabelOf(item, type);
  const labelOf = (key: string) => type?.fieldsSchema.find((f) => f.key === key)?.label ?? key;
  const also = alsoMatchedBy(item, rows, items);

  return (
    <>
      <section aria-labelledby="h-det">
        <h3 id="h-det" className={`${C.sectionH} mb-1`}>
          {t("detailsHeading")}
        </h3>
        <dl>
          <DRow label={t("fieldComponent")}>
            {type ? type.name : <span className={UNASSIGNED_BADGE}>{t("unassigned")}</span>}
          </DRow>
          {type ? (
            <DRow
              label={
                <span className="inline-flex items-center gap-1.5">
                  {t("fieldPart")} <InfoTip text={t("tipPart")} />
                </span>
              }
            >
              {part ?? <span className="font-normal text-text-muted">{t("partOther")}</span>}
            </DRow>
          ) : null}
          <DRow label={t("fieldUnit")}>{unitSymbol(item.measurementUnit)}</DRow>
          <DRow label={t("fieldPackSize")}>{packLabel(item.measurementUnit, item.perUnitQuantity)}</DRow>
          <DRow
            label={
              <span className="inline-flex items-center gap-1.5">
                {t("fieldWholePacks")} <InfoTip text={t("tipWholePacks")} />
              </span>
            }
          >
            {item.soldInWholePacks ? t("yes") : t("no")}
          </DRow>
        </dl>
      </section>

      {type ? (
        <section aria-labelledby="h-m">
          <h3 id="h-m" className={`${C.sectionH} mb-1 flex items-center justify-between gap-1.5`}>
            <span className="inline-flex items-center gap-1.5">
              {t("matchesHeading")} <InfoTip text={t("tipMatches")} />
            </span>
          </h3>
          {entries.length > 0 ? (
            <dl>
              {entries.map(([key, value], i) => (
                <DRow key={key} label={labelOf(key)}>
                  <span className="inline-flex items-center gap-2">
                    {staleIssue(issues[i]) ? (
                      <span className="inline-flex items-center rounded-full border border-status-pending-border bg-status-pending-bg px-2 py-px text-[11px] font-extrabold text-status-pending-text">
                        {t("staleBadge")}
                      </span>
                    ) : null}
                    <span className="font-mono text-xs">{value}</span>
                  </span>
                </DRow>
              ))}
            </dl>
          ) : (
            <p className="py-1 text-[13px] text-text-muted">{t("matchesNone")}</p>
          )}
          <AlsoMatchedBy others={also} onOpenItem={onOpenItem} />
        </section>
      ) : null}
    </>
  );
}
