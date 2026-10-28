"use client";

/**
 * Right-rail "Width" field for the solo-selected panel — Stage 34 (S34-2, D-B3-2; mockup v7).
 *
 * Explicit apply: the value applies ONLY via the tick (shown while editing) or Enter. Blur and Escape
 * discard the typed value; an invalid or refused value keeps the field open with an inline error.
 * A tick with an unchanged value just closes (no lock). A locked panel shows the value read-only with
 * a lock icon; focusing or clicking it shows "Panel is locked · Unlock" (NOTIFY_LOCKED).
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { blockNumericKeys, sanitizeNumericPaste } from "@/lib/numeric-input";
import { isUnchangedDisplayValue, planSetWidths } from "@/lib/panel-widths";
import { useDraftContext } from "./design-draft-context";
import { useUnit } from "./unit-context";
import { LockIcon, TickIcon } from "./lock-icons";
import type { DesignPanel } from "./types";

export function RailWidthField({ panel }: { panel: DesignPanel }) {
  const t = useTranslations("design");
  const { toDisplay, fromDisplay, unit } = useUnit();
  const { state, dispatch } = useDraftContext();
  // null = not editing (show the live value); a string = the typed draft.
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editing = text !== null;
  const shown = text ?? String(toDisplay(panel.widthMm));

  function revert() {
    setText(null);
    setError(null);
  }

  function apply() {
    const parsed = Number(text);
    if (text === null || text.trim() === "" || !Number.isFinite(parsed)) {
      setError(t("widthRefusalINVALID"));
      return;
    }
    // Unchanged is decided in display units (see isUnchangedDisplayValue): no drift, no lock.
    if (isUnchangedDisplayValue(parsed, panel.widthMm, toDisplay)) {
      revert();
      return;
    }
    const mm = Math.round(fromDisplay(parsed));
    const panels = state.draft?.design?.panels ?? [];
    const plan = planSetWidths(panels, [panel.id], mm);
    if (!plan.ok) {
      setError(t(`widthRefusal${plan.reason}`));
      return;
    }
    dispatch({ type: "SET_PANEL_WIDTH", panelIds: [panel.id], widthMm: mm });
    revert();
  }

  return (
    <section className="mb-4" data-testid="rail-width-section">
      <h3 className="mb-0.5 text-[10.5px] font-bold uppercase tracking-[.04em] text-text-muted">
        <label htmlFor="rail-width-input">{t("railWidthLabel")}</label>
      </h3>
      <div className="flex items-center gap-2">
        <input
          id="rail-width-input"
          type="number"
          step="any"
          value={shown}
          readOnly={!!panel.locked}
          aria-invalid={error ? true : undefined}
          title={panel.locked ? t("panelIsLocked") : undefined}
          onFocus={() => {
            // A locked panel's width can't be typed: say so (Stage 34 Batch 4) instead of opening an edit.
            if (panel.locked) {
              dispatch({ type: "NOTIFY_LOCKED", panelIds: [panel.id] });
              return;
            }
            if (text === null) setText(String(toDisplay(panel.widthMm)));
          }}
          onClick={() => {
            if (panel.locked) dispatch({ type: "NOTIFY_LOCKED", panelIds: [panel.id] });
          }}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onBlur={revert}
          onKeyDown={(e) => {
            blockNumericKeys(e);
            if (e.key === "Enter") {
              e.preventDefault();
              if (!panel.locked) apply();
            } else if (e.key === "Escape") {
              // Don't let the workspace's document-level Escape handler also deselect the panel.
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              revert();
              e.currentTarget.blur();
            }
          }}
          onPaste={sanitizeNumericPaste}
          className={
            "w-[86px] rounded-[6px] border px-[7px] py-[5px] text-right text-xs font-bold text-text-heading focus:outline-none " +
            (error
              ? "border-red-600 bg-red-50"
              : panel.locked
                ? "cursor-not-allowed border-border bg-[#f1f3ec] text-text-muted"
                : "border-[var(--color-border-strong)] bg-bg-white focus:border-primary")
          }
        />
        {(editing || error) && !panel.locked && (
          <button
            type="button"
            data-testid="rail-width-tick"
            title={t("applyWidthTick")}
            aria-label={t("applyWidthTick")}
            // mousedown is cancelled so the input keeps focus (its blur would discard the draft).
            onMouseDown={(e) => e.preventDefault()}
            onClick={apply}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-primary-dark bg-primary text-white hover:bg-primary-dark"
          >
            <TickIcon />
          </button>
        )}
        <span className="text-[11px] font-semibold text-text-muted">{unit}</span>
        {panel.locked && (
          <span className="ml-auto flex text-primary-dark" title={t("panelIsLocked")} data-testid="rail-lock-state">
            <LockIcon size={14} />
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-[11.5px] font-semibold text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
