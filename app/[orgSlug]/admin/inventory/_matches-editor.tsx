"use client";

import { useTranslations } from "next-intl";
import { SelectField } from "@/components/select-field";
import { canAddRow, pickableFields, rowIssues, rowsReducer, staleIssue, valueOptions } from "@/lib/inventory-draft";
import type { DraftRow, RowAction, RowIssue } from "@/lib/inventory-draft";
import type { ListType } from "@/lib/inventory-list";
import { C } from "./_styles";

/**
 * The Matches rows editor of the Inventory drawer (mockup A rev 7, layout `mt=1`, inline rows): a field picker
 * over ALL fields of the component type except those another row already uses, a value control by field type,
 * a remove button, a dashed "Add match" button and the empty "No matches" text. A row whose field or value is no
 * longer valid is flagged "No longer valid"; the flag and the duplicate message always show, every other message
 * waits for the first save attempt (`showAll`). The rule is the shared Batch 2 one (`lib/inventory-draft`).
 */

const X_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

interface MatchesEditorProps {
  type: ListType;
  rows: DraftRow[];
  onChange: (rows: DraftRow[]) => void;
  /** True once the user tried to save: shows every row message, not only the stale and duplicate ones. */
  showAll: boolean;
  disabled?: boolean;
}

export function MatchesEditor({ type, rows, onChange, showAll, disabled }: MatchesEditorProps) {
  const t = useTranslations("inventory");
  const issues = rowIssues(rows, type);
  const dispatch = (action: RowAction) => onChange(rowsReducer(rows, action));

  function issueText(issue: RowIssue, key: string): string | null {
    const fieldType = type.fieldsSchema.find((f) => f.key === key)?.type;
    switch (issue) {
      case "FIELD_REMOVED":
        return t("staleField");
      case "VALUE_NOT_OFFERED":
        return t("staleValue");
      case "DUPLICATE":
        return t("rowDuplicate");
      case "NO_FIELD":
        return showAll ? t("chooseField") : null;
      case "EMPTY":
        return showAll ? (fieldType === "field" ? t("rowEmpty") : t("chooseValue")) : null;
      case "NOT_BOOLEAN_WORD":
        return showAll ? t("rowYesNo") : null;
      case "NOT_CANONICAL":
        return showAll ? t("rowNotCanonical") : null;
      default:
        return null;
    }
  }

  return (
    <div>
      {rows.length === 0 ? <p className="py-1 text-[13px] text-text-muted">{t("matchesNone")}</p> : null}
      {rows.map((row, i) => {
        const issue = issues[i];
        const message = issueText(issue, row.key);
        const field = type.fieldsSchema.find((f) => f.key === row.key);
        const label = field?.label ?? row.key;
        const pick = pickableFields(type, rows, i);
        const cls = `${C.input} ${message ? C.inErr : C.inOk} text-left`;
        const offered = valueOptions(type, row.key);
        return (
          <div key={i} className="py-1.5">
            <div className="grid grid-cols-[1fr_1fr_28px] items-center gap-2">
              <SelectField
                value={row.key}
                placeholder={t("chooseField")}
                disabled={disabled}
                className={cls}
                onChange={(e) => dispatch({ type: "setKey", index: i, key: e.target.value })}
              >
                {row.key !== "" && !field ? <option value={row.key}>{row.key}</option> : null}
                {pick.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </SelectField>
              {row.key === "" ? (
                <SelectField value="" placeholder={t("chooseValue")} disabled className={cls}>
                  {null}
                </SelectField>
              ) : field?.type === "field" ? (
                <input
                  value={row.value}
                  disabled={disabled}
                  aria-label={label}
                  onChange={(e) => dispatch({ type: "setValue", index: i, value: e.target.value })}
                  className={`${C.input} ${message ? C.inErr : C.inOk} text-right tabular-nums`}
                />
              ) : (
                <SelectField
                  value={row.value}
                  placeholder={t("chooseValue")}
                  disabled={disabled}
                  className={cls}
                  onChange={(e) => dispatch({ type: "setValue", index: i, value: e.target.value })}
                >
                  {row.value !== "" && !offered.includes(row.value) ? (
                    <option value={row.value}>{t("notOffered", { value: row.value })}</option>
                  ) : null}
                  {offered.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </SelectField>
              )}
              <button
                type="button"
                disabled={disabled}
                aria-label={t("removeMatch", { field: label || t("chooseField") })}
                onClick={() => dispatch({ type: "remove", index: i })}
                className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-danger-bg hover:text-red-700 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
              >
                {X_ICON}
              </button>
            </div>
            {staleIssue(issue) ? (
              <div className="mt-1 flex items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-status-pending-border bg-status-pending-bg px-2 py-px text-[11px] font-extrabold text-status-pending-text">
                  {t("staleBadge")}
                </span>
                <span className="text-xs font-bold text-[var(--color-status-failed-text)]">{message}</span>
              </div>
            ) : message ? (
              <p className={C.err}>{message}</p>
            ) : null}
          </div>
        );
      })}
      {!disabled && canAddRow(type, rows) ? (
        <button
          type="button"
          onClick={() => dispatch({ type: "add" })}
          className="mt-2 flex h-8 w-full items-center justify-center rounded-sm border border-dashed border-border-strong text-xs font-bold text-primary-dark hover:bg-primary-softer focus-visible:outline-2 focus-visible:outline-primary"
        >
          {t("addMatch")}
        </button>
      ) : null}
    </div>
  );
}
