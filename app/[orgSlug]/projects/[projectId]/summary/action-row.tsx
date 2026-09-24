"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProblemPopup } from "../_problem-popup";
import { redirectToLogin } from "../design/login-redirect";
import type { CalculationProblemReport } from "@/lib/materials/problems";
import type { Summary, MaterialListLine } from "@/lib/summary/types";
import type { ConfigSnapshot } from "@/lib/config-snapshot";

/**
 * Summary page action row (Stage 26 Batch 2 shape, Batch 3/4 wiring) — Recompute + Export PDF buttons,
 * matching the signed-off `mockup-batch0.html` (idle / recomputing / not-DRAFT+tooltip states)
 * translated to the app's Tailwind tokens.
 *
 * Recompute is fully wired: POST .../recompute, 200 → router.refresh() (Batch 1's GET .../calculation
 * re-fetch on the Server Component re-render supplies the fresh data), 422 → ProblemPopup (same pattern
 * as design-workspace.tsx's handleSubmitDesign), 409/other → an inline message, 401/403 → redirect to
 * login.
 *
 * Export PDF (Batch 4, S26-5): both `lib/summary/pdf-rows.ts` (pure data-shaping) and `lib/summary/pdf.ts`
 * (the sole jsPDF import site) are dynamically imported inside `handleExport()` on click — the ~500 KB
 * jsPDF bundle never loads on initial page render.
 */
interface ActionRowProps {
  /** Gates Recompute per S26-8 — disabled+tooltip when the project is not DRAFT. */
  isDraft: boolean;
  /** False on the FAILED-row page state (no KPI/Material data to export). */
  showExport: boolean;
  orgSlug: string;
  projectId: string;
  isSubdomain: boolean;
  /** Only needed (and only passed by the caller) when showExport is true. */
  orgName?: string;
  projectLine?: string;
  clientLabel?: string;
  clientValue?: string;
  computedAtLabel?: string;
  summary?: Summary;
  materialList?: MaterialListLine[];
  configSnapshot?: ConfigSnapshot | null;
  filename?: string;
}

export function ActionRow({
  isDraft,
  showExport,
  orgSlug,
  projectId,
  isSubdomain,
  orgName,
  projectLine,
  clientLabel,
  clientValue,
  computedAtLabel,
  summary,
  materialList,
  configSnapshot,
  filename,
}: ActionRowProps) {
  const router = useRouter();
  const [recomputing, setRecomputing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [report, setReport] = useState<CalculationProblemReport | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  async function handleRecompute() {
    if (!isDraft) return;
    setConflictMessage(null);
    setReport(null);
    setRecomputing(true);
    try {
      const res = await fetch(
        `/api/v1/orgs/${orgSlug}/projects/${projectId}/recompute`,
        { method: "POST" },
      );
      if (res.status === 401 || res.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return;
      }
      // 422: calculation was refused — show the problem popup instead of a generic error.
      if (res.status === 422) {
        const body = (await res.json().catch(() => null)) as CalculationProblemReport | null;
        if (body?.ok === false && Array.isArray(body.problems)) {
          setReport(body);
        } else {
          setConflictMessage("Recompute failed — fix the problems and try again.");
        }
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setConflictMessage(body.error ?? "Could not recompute — please try again.");
        return;
      }
      // 200 — the stored row was updated. Re-render the Server Component so Batch 1's
      // GET .../calculation supplies the fresh summary/material list/computedAt.
      router.refresh();
    } catch {
      setConflictMessage("Network error — please try again.");
    } finally {
      setRecomputing(false);
    }
  }

  async function handleExport() {
    if (!summary || !materialList || !orgName || !projectLine || !clientLabel || !clientValue
      || !computedAtLabel || !filename) {
      return;
    }
    setConflictMessage(null);
    setExporting(true);
    try {
      const [{ buildKpiPdfTables, buildMaterialPdfTables }, { generateSummaryPdf }] = await Promise.all([
        import("@/lib/summary/pdf-rows"),
        import("@/lib/summary/pdf"),
      ]);
      const kpi = buildKpiPdfTables(summary);
      const material = buildMaterialPdfTables(materialList, configSnapshot ?? { takenAt: "", componentTypes: [] });
      await generateSummaryPdf({
        header: { orgName, projectLine, clientLabel, clientValue, computedAtLabel },
        kpi,
        material,
        filename,
      });
    } catch {
      setConflictMessage("Could not generate the PDF — please try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mb-4">
      <div className="flex items-center justify-end gap-2.5">
        <div className="group relative inline-flex">
          {!isDraft && (
            <div className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-md bg-text-heading px-2.5 py-1.5 text-[11.5px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
              Recompute is only available while the project is in Draft
            </div>
          )}
          <button
            type="button"
            disabled={!isDraft || recomputing}
            onClick={() => void handleRecompute()}
            className="inline-flex items-center gap-2 rounded-sm border border-border bg-bg-white px-4 py-2 text-[13px] font-bold text-text-body hover:bg-primary-softer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-bg-white"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-[15px] w-[15px] ${recomputing ? "animate-spin" : ""}`}
              aria-hidden="true"
            >
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span>{recomputing ? "Recomputing…" : "Recompute"}</span>
          </button>
        </div>

        {showExport && (
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleExport()}
            className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-[13px] font-bold text-text-on-primary hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-[15px] w-[15px]"
              aria-hidden="true"
            >
              <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
            </svg>
            <span>{exporting ? "Generating…" : "Export PDF"}</span>
          </button>
        )}
      </div>

      {conflictMessage && (
        <p role="alert" className="mt-2 text-right text-xs font-semibold text-text-muted">
          {conflictMessage}
        </p>
      )}

      {report && (
        <ProblemPopup
          report={report}
          title="Recompute failed"
          orgSlug={orgSlug}
          projectId={projectId}
          isSubdomain={isSubdomain}
          onClose={() => setReport(null)}
        />
      )}
    </div>
  );
}
