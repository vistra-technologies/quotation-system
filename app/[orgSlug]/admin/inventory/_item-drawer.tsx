"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { alsoMatchedBy, partLabelOf } from "@/lib/inventory-list";
import type { ListItem, ListType } from "@/lib/inventory-list";
import { checkMatchRows, readMatchRows } from "@/lib/inventory-matches";
import { packLabel, unitSymbol } from "@/lib/units";
import { DrawerShell } from "./_drawer-shell";
import { ACTIVE_BADGE, C, INACTIVE_BADGE, UNASSIGNED_BADGE } from "./_styles";

/**
 * The Inventory item drawer (mockup A rev 7). Batch 3 commit 2 builds the shell and the read-only view; the
 * edit and create forms arrive in the next commit, so `create` opens the shell with its title only for now.
 *
 * Where Stage 38a's Prices section will sit: below Matches. Nothing is rendered there and no price is shown.
 */

export type DrawerTarget = { kind: "item"; id: string } | { kind: "new" };

interface ItemDrawerProps {
  target: DrawerTarget;
  items: ListItem[];
  types: ListType[];
  onClose: () => void;
  /** Switch the drawer to another item ("Also matched by" links). */
  onOpenItem: (id: string) => void;
  getRestoreTarget?: () => HTMLElement | null;
}

export function InfoTip({ text }: { text: string }) {
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-text-muted text-[10px] font-extrabold normal-case tracking-normal text-text-muted"
    >
      i
    </span>
  );
}

const CLOSE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
const LINK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);

/** "Also matched by <code>, <code>" with each code a button that switches to that item. */
export function AlsoMatchedBy({
  others,
  onOpenItem,
  inList,
}: {
  others: ListItem[];
  onOpenItem: (id: string) => void;
  inList?: boolean;
}) {
  const t = useTranslations("inventory");
  if (others.length === 0) return null;
  const codes = others.map((o, i) => (
    <span key={o.id}>
      {i > 0 ? ", " : ""}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenItem(o.id);
        }}
        className="font-mono font-semibold text-primary-dark underline underline-offset-2 hover:text-text-heading focus-visible:outline-2 focus-visible:outline-primary"
      >
        {o.code}
      </button>
    </span>
  ));
  return (
    <div className={`${inList ? "mt-0.5 text-[11.5px]" : "mt-2 text-xs"} flex items-center gap-1.5 text-text-muted`}>
      {LINK_ICON}
      <span>{t.rich("alsoMatchedBy", { codes: () => <>{codes}</> })}</span>
    </div>
  );
}

function DRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <dt className="text-[13px] text-text-muted">{label}</dt>
      <dd className="text-right text-[13px] font-semibold text-text-heading">{children}</dd>
    </div>
  );
}

export function InventoryItemDrawer({ target, items, types, onClose, onOpenItem, getRestoreTarget }: ItemDrawerProps) {
  const t = useTranslations("inventory");
  const titleId = useId();
  const item = target.kind === "item" ? (items.find((i) => i.id === target.id) ?? null) : null;
  const type = item?.componentTypeId ? types.find((x) => x.id === item.componentTypeId) : undefined;

  return (
    <DrawerShell titleId={titleId} onRequestClose={onClose} getRestoreTarget={getRestoreTarget}>
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
          <button type="button" onClick={onClose} aria-label={t("close")} className={C.icon}>
            {CLOSE_ICON}
          </button>
        </div>
      </div>
      {item ? <ItemView item={item} type={type} items={items} onOpenItem={onOpenItem} /> : <div className="flex-1" />}
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
  const checked = type
    ? new Map(checkMatchRows(entries.map(([key, value]) => ({ key, value })), type.fieldsSchema, type.fieldOptionsConfig).map((r) => [r.key, r.problem]))
    : new Map<string, string | null>();
  const part = partLabelOf(item, type);
  const labelOf = (key: string) => type?.fieldsSchema.find((f) => f.key === key)?.label ?? key;
  const also = alsoMatchedBy(item, rows, items);

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
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
              {entries.map(([key, value]) => {
                const problem = checked.get(key);
                const stale = problem === "FIELD_REMOVED" || problem === "VALUE_NOT_OFFERED";
                return (
                  <DRow key={key} label={labelOf(key)}>
                    <span className="inline-flex items-center gap-2">
                      {stale ? (
                        <span className="inline-flex items-center rounded-full border border-status-pending-border bg-status-pending-bg px-2 py-px text-[11px] font-extrabold text-status-pending-text">
                          {t("staleBadge")}
                        </span>
                      ) : null}
                      <span className="font-mono text-xs">{value}</span>
                    </span>
                  </DRow>
                );
              })}
            </dl>
          ) : (
            <p className="py-1 text-[13px] text-text-muted">{t("matchesNone")}</p>
          )}
          <AlsoMatchedBy others={also} onOpenItem={onOpenItem} />
        </section>
      ) : null}
      {/* Stage 38a: the Prices section sits here. No price is shown in Stage 37. */}
    </div>
  );
}
