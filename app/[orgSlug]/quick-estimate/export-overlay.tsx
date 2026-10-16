"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SupportedCurrency } from "@/lib/currency";
import type { EstimateResult, ValueLine } from "@/lib/quick-estimate/estimate";
import { ExportPreview } from "./export-preview";
import { useFocusTrap } from "./use-focus-trap";
import "./quick-estimate.css";

interface ExportOverlayProps {
  orgName: string;
  currency: SupportedCurrency;
  lines: ValueLine[];
  result: EstimateResult;
  initialPreparedFor: string;
  projectName: string;
  onClose: () => void;
}

/**
 * The export step on its own, for the inquiry pages (the New Inquiry section and the detail card export an
 * attached estimate without opening the popup). Same preview and PDF as the popup's export step; the popup's
 * CSS variables live on `.qe-root`, so it is portalled into one. Esc and Back close it and focus returns to
 * whatever opened it.
 */
export function ExportOverlay({ orgName, currency, lines, result, initialPreparedFor, projectName, onClose }: ExportOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Captured during the first render: ExportPreview focuses its input in an effect, which runs before this one.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  useFocusTrap(rootRef);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => opener?.focus?.(), [opener]);

  return createPortal(
    <div ref={rootRef} className="qe-root">
      <ExportPreview
        orgName={orgName}
        currency={currency}
        lines={lines}
        result={result}
        initialPreparedFor={initialPreparedFor}
        projectName={projectName}
        onBack={onClose}
      />
    </div>,
    document.body,
  );
}
