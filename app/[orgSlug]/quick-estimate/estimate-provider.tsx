"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { SupportedCurrency } from "@/lib/currency";
import type { EstimateDraft } from "@/lib/quick-estimate/lines";
import type { EstimateType } from "@/lib/quick-estimate/palette";
import { useEstimateState, type EstimateState } from "./use-estimate-state";

/**
 * The popup's inquiry mode (S33-23): the currency is locked to the inquiry's, the primary footer button
 * attaches/updates instead of exporting. `onAttach` receives the popup state; the caller persists it.
 */
export interface InquiryMode {
  currency: SupportedCurrency;
  isUpdate: boolean;
  onAttach: (snapshot: EstimateDraft) => void;
  /** Read when the export step opens, so it reflects the live form: "Prepared for" default and project name. */
  getExportMeta: () => { preparedFor: string; projectName: string };
}

export type OpenRequest =
  | { kind: "standalone"; returnFocus: HTMLElement | null }
  | {
      kind: "inquiry";
      /** `draft` = the shared persistent draft (a fresh estimate on the form); `session` = the storage-free copy. */
      source: "draft" | "session";
      mode: InquiryMode;
      returnFocus: HTMLElement | null;
    };

interface EstimateContextValue {
  orgSlug: string;
  orgName: string;
  /** The setup guard (S33-2) passed. */
  enabled: boolean;
  types: EstimateType[];
  defaultCurrency: SupportedCurrency;
  /** The one persistent draft, mirrored to sessionStorage under `qe:v1:<orgSlug>`. */
  draft: EstimateState;
  /** Storage-free copy the inquiry pages seed and edit; never written to sessionStorage. */
  session: EstimateState;
  request: OpenRequest | null;
  open: (request: OpenRequest) => void;
  /** Closes the popup and returns focus to the opener. */
  close: () => void;
  /** The top-bar calculator icon: closes when open, else the registered inquiry form's opener, else standalone. */
  toggleFromIcon: (trigger: HTMLElement | null) => void;
  /** The New Inquiry form registers itself while mounted, so the top-bar icon opens its inquiry-mode popup. */
  registerInquiryOpener: (opener: ((trigger: HTMLElement | null) => void) | null) => void;
}

const EstimateContext = createContext<EstimateContextValue | null>(null);

interface EstimateProviderProps {
  orgSlug: string;
  orgName: string;
  enabled: boolean;
  types: EstimateType[];
  defaultCurrency: SupportedCurrency;
  children: ReactNode;
}

/**
 * Owns the Quick Estimate draft for the whole org shell (D-22). Hoisted into `app/[orgSlug]/layout.tsx` so the
 * top bar, the New Inquiry form and the inquiry detail card share one draft instead of racing on one
 * sessionStorage key. `TopBarActions` renders the single popup from `request`; nothing else renders one.
 */
export function EstimateProvider({ orgSlug, orgName, enabled, types, defaultCurrency, children }: EstimateProviderProps) {
  const draft = useEstimateState(orgSlug, enabled, types, defaultCurrency);
  const session = useEstimateState(orgSlug, enabled, types, defaultCurrency, { persist: false });
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const requestRef = useRef<OpenRequest | null>(null);
  const inquiryOpener = useRef<((trigger: HTMLElement | null) => void) | null>(null);

  const open = useCallback(
    (next: OpenRequest) => {
      if (!enabled) return;
      requestRef.current = next;
      setRequest(next);
    },
    [enabled],
  );

  const close = useCallback(() => {
    const current = requestRef.current;
    requestRef.current = null;
    setRequest(null);
    current?.returnFocus?.focus();
  }, []);

  const toggleFromIcon = useCallback(
    (trigger: HTMLElement | null) => {
      if (requestRef.current) {
        close();
        return;
      }
      if (!enabled) return;
      if (inquiryOpener.current) inquiryOpener.current(trigger);
      else open({ kind: "standalone", returnFocus: trigger });
    },
    [close, enabled, open],
  );

  const registerInquiryOpener = useCallback((opener: ((trigger: HTMLElement | null) => void) | null) => {
    inquiryOpener.current = opener;
  }, []);

  return (
    <EstimateContext.Provider
      value={{ orgSlug, orgName, enabled, types, defaultCurrency, draft, session, request, open, close, toggleFromIcon, registerInquiryOpener }}
    >
      {children}
    </EstimateContext.Provider>
  );
}

export function useEstimate(): EstimateContextValue {
  const ctx = useContext(EstimateContext);
  if (!ctx) throw new Error("useEstimate must be used inside EstimateProvider");
  return ctx;
}
