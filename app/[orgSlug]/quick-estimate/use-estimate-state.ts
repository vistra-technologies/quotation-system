"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupportedCurrency } from "@/lib/currency";
import { parseUnitPrice, type DiscountMode } from "@/lib/quick-estimate/estimate";
import { emptyDraft, hasDraftItems, newLine, type EstimateDraft } from "@/lib/quick-estimate/lines";
import type { EstimateOption, EstimateType } from "@/lib/quick-estimate/palette";
import { draftStorageActive, parseStoredDraft, serializeDraft, storageKey } from "@/lib/quick-estimate/storage";

/** Removes the saved draft; called on Log Out before the session ends (S33-8). Never throws. */
export function clearStoredEstimate(orgSlug: string) {
  try {
    sessionStorage.removeItem(storageKey(orgSlug));
  } catch {
    // sessionStorage unavailable: nothing was stored.
  }
}

/**
 * The Quick Estimate draft (S33-8). Owned by `EstimateProvider` (hoisted into the org layout, D-22), which
 * persists across client navigation, and mirrored to sessionStorage so a reload in the same tab keeps it. Hydration happens in a
 * mount effect (state starts empty), and the persist effect waits for it so the empty initial state can't
 * overwrite the saved draft.
 */
export function useEstimateState(
  orgSlug: string,
  enabled: boolean,
  types: EstimateType[],
  defaultCurrency: SupportedCurrency,
  /** `persist: false` is the storage-free session copy the inquiry pages edit (S33-19, S33-23). */
  options: { persist?: boolean } = {},
) {
  const persist = options.persist !== false;
  const idRef = useRef(0);
  const nextId = useCallback(() => `ql${++idRef.current}`, []);
  const [draft, setDraft] = useState<EstimateDraft>(() => emptyDraft(defaultCurrency));
  const [loaded, setLoaded] = useState(false);
  // The currency before the last change, for Undo on the currency-change banner. Not persisted.
  const [prevCurrency, setPrevCurrency] = useState<SupportedCurrency | null>(null);

  // Until the guard has really passed (see draftStorageActive) the stored draft is left untouched.
  const active = persist && draftStorageActive(enabled, types);

  useEffect(() => {
    if (!active || loaded) return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(storageKey(orgSlug));
    } catch {
      raw = null;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-only hydration from sessionStorage (avoids an SSR mismatch)
    setDraft(parseStoredDraft(raw, types, defaultCurrency, nextId));
    setLoaded(true);
    // Once, as soon as the guard has passed: later prop changes (router.refresh) must not discard the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!persist || !loaded) return;
    try {
      sessionStorage.setItem(storageKey(orgSlug), serializeDraft(draft));
    } catch {
      // Quota or privacy mode: the draft just isn't kept across a reload.
    }
  }, [draft, loaded, orgSlug, persist]);

  const currentCurrency = draft.currency;
  const setCurrency = useCallback(
    (next: SupportedCurrency) => {
      if (next === currentCurrency) return;
      setPrevCurrency(currentCurrency);
      // Rates are never converted: flag every line that has one so the user re-checks it (D-7).
      setDraft((d) => ({
        ...d,
        currency: next,
        lines: d.lines.map((l) => ({ ...l, flag: parseUnitPrice(l.rate) > 0 })),
      }));
    },
    [currentCurrency],
  );

  const undoCurrency = useCallback(() => {
    setDraft((d) => ({
      ...d,
      currency: prevCurrency ?? d.currency,
      lines: d.lines.map((l) => ({ ...l, flag: false })),
    }));
    setPrevCurrency(null);
  }, [prevCurrency]);

  const acceptRates = useCallback(() => {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => ({ ...l, flag: false })) }));
    setPrevCurrency(null);
  }, []);

  // Toggling the mode resets the value to blank (D-6).
  const setDiscountMode = useCallback((mode: DiscountMode) => {
    setDraft((d) => (d.discountMode === mode ? d : { ...d, discountMode: mode, discountValue: "" }));
  }, []);
  const setDiscountValue = useCallback((v: string) => setDraft((d) => ({ ...d, discountValue: v })), []);
  const setTaxPct = useCallback((v: string) => setDraft((d) => ({ ...d, taxPct: v })), []);

  const addLine = useCallback((): string => {
    const id = nextId();
    setDraft((d) => ({ ...d, lines: [...d.lines, newLine(id)] }));
    return id;
  }, [nextId]);

  const removeLine = useCallback((id: string) => {
    setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) }));
  }, []);

  const chooseItem = useCallback((id: string, type: EstimateType, option: EstimateOption) => {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) =>
        l.id !== id
          ? l
          : {
              ...l,
              typeCode: type.code,
              itemName: type.name,
              variantText: option.text,
              unit: type.unit,
              // A different unit makes the old quantity meaningless.
              qty: l.unit !== null && l.unit !== type.unit ? "" : l.qty,
            },
      ),
    }));
  }, []);

  const setQty = useCallback((id: string, v: string) => {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, qty: v } : l)) }));
  }, []);

  // Editing a flagged rate clears its flag.
  const setRate = useCallback((id: string, v: string) => {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, rate: v, flag: false } : l)) }));
  }, []);

  // Clear all empties the lines only; currency, discount and tax stay (S33-8).
  const clearLines = useCallback(() => {
    setDraft((d) => ({ ...d, lines: [] }));
    setPrevCurrency(null);
  }, []);

  // Replace the whole state (inquiry pages: seed the session copy, write an attach back, restore on Undo).
  // Lines get fresh ids from this instance, so ids from another instance can never collide with `addLine`.
  const reset = useCallback(
    (next: EstimateDraft) => {
      setDraft({ ...next, lines: next.lines.map((l) => ({ ...l, id: nextId() })) });
      setPrevCurrency(null);
    },
    [nextId],
  );

  return {
    draft,
    hasDraft: hasDraftItems(draft.lines),
    reset,
    prevCurrency,
    setCurrency,
    undoCurrency,
    acceptRates,
    setDiscountMode,
    setDiscountValue,
    setTaxPct,
    addLine,
    removeLine,
    chooseItem,
    setQty,
    setRate,
    clearLines,
  };
}

export type EstimateState = ReturnType<typeof useEstimateState>;
