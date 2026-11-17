"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupportedCurrency } from "@/lib/currency";
import type { AreaUnit } from "@/lib/quick-estimate/area-units";
import { MAX_LINE_DESCRIPTION, type DiscountMode } from "@/lib/quick-estimate/estimate";
import { emptyDraft, hasDraftItems, newLine, type DraftLine, type EstimateDraft } from "@/lib/quick-estimate/lines";
import type { EstimateOption, EstimateType } from "@/lib/quick-estimate/palette";
import { draftStorageActive, parseStoredDraft, serializeDraft, storageKey } from "@/lib/quick-estimate/storage";
import { applyChoice, relookupForCurrency, resetRate as resetLineRate, restorePricing, snapshotPricing, switchAreaUnit, type PricingLookup, type PricingSnapshot } from "@/lib/quick-estimate/suggest";

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
  /** Stage 36: product prices by component type id then combination key; `{}` when none or not allowed (S36-10). */
  pricing: PricingLookup,
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
  // Stage 36: the rate/suggestion of each line before a currency switch re-looked it up, so Undo restores them.
  const prevPricing = useRef<Record<string, PricingSnapshot> | null>(null);

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
      // Rates are never converted (D-7: flag every line that has one so the user re-checks it). Stage 36 S36-11:
      // a line with a combination key is re-looked up in the new currency instead.
      setDraft((d) => {
        prevPricing.current = snapshotPricing(d.lines);
        return { ...d, currency: next, lines: d.lines.map((l) => relookupForCurrency(l, types, pricing, next)) };
      });
    },
    [currentCurrency, types, pricing],
  );

  const undoCurrency = useCallback(() => {
    setDraft((d) => {
      const saved = prevPricing.current;
      return {
        ...d,
        currency: prevCurrency ?? d.currency,
        lines: d.lines.map((l) => restorePricing(l, saved?.[l.id])),
      };
    });
    prevPricing.current = null;
    setPrevCurrency(null);
  }, [prevCurrency]);

  const currentAreaUnit = draft.areaUnit;
  // S36-13 / S36-18: qty converts, every area line's rate resets to the exact product price or empty. Returns whether
  // a typed or overridden rate was replaced, so the caller can show the one "Price reset to default" toast.
  // Undo of a currency switch is dropped: its saved rates belong to the other unit.
  const setAreaUnit = useCallback(
    (next: AreaUnit): boolean => {
      if (next === currentAreaUnit) return false;
      const result = switchAreaUnit(draft, next, types, pricing);
      setDraft(result.draft);
      prevPricing.current = null;
      setPrevCurrency(null);
      return result.replaced;
    },
    [currentAreaUnit, draft, types, pricing],
  );

  const acceptRates = useCallback(() => {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => ({ ...l, flag: false })) }));
    prevPricing.current = null;
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

  // Stage 36: a spec-mode pick also fills the rate from the product price and the description from its row.
  const chooseItem = useCallback(
    (id: string, type: EstimateType, option: EstimateOption) => {
      setDraft((d) => ({
        ...d,
        lines: d.lines.map((l) => (l.id !== id ? l : applyChoice(l, type, option, pricing, d.currency, d.areaUnit))),
      }));
    },
    [pricing],
  );

  const setQty = useCallback((id: string, v: string) => {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, qty: v } : l)) }));
  }, []);

  // Editing a flagged rate clears its flag.
  const setRate = useCallback((id: string, v: string) => {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, rate: v, flag: false } : l)) }));
  }, []);

  // The inline Reset (S36-11): back to the suggested rate.
  const resetRate = useCallback((id: string) => {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? resetLineRate(l) : l)) }));
  }, []);

  const setAttachDescription = useCallback((id: string, on: boolean) => {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, attachDescription: on } : l)) }));
  }, []);

  // An edit never writes back to the admin row (S36-12).
  const setDescription = useCallback((id: string, text: string) => {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) =>
        l.id === id ? { ...l, description: text.slice(0, MAX_LINE_DESCRIPTION), descriptionEdited: true } : l,
      ),
    }));
  }, []);

  // Clear all empties the lines only; currency, discount and tax stay (S33-8).
  const clearLines = useCallback(() => {
    setDraft((d) => ({ ...d, lines: [] }));
    prevPricing.current = null;
    setPrevCurrency(null);
  }, []);

  // Replace the whole state (inquiry pages: seed the session copy, write an attach back, restore on Undo).
  // Lines get fresh ids from this instance, so ids from another instance can never collide with `addLine`.
  const reset = useCallback(
    (next: EstimateDraft) => {
      setDraft({ ...next, lines: next.lines.map((l) => ({ ...l, id: nextId() })) });
      prevPricing.current = null;
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
    setAreaUnit,
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
    resetRate,
    setAttachDescription,
    setDescription,
    clearLines,
  };
}

export type EstimateState = ReturnType<typeof useEstimateState>;
