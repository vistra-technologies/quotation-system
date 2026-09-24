"use client";

/**
 * Problem popup — Stage 25 Batch 9.
 *
 * Shared popup rendered when Submit Design (Design page) or Recompute (Summary page, Stage 26)
 * returns 422 + CalculationProblemReport.  Displays problems grouped by scope with locus-aware
 * "Go →" navigation links per the approved mockup (problem-popup-poc.html, 2026-09-24).
 *
 * Link rules (resolved decisions):
 *   DESIGN   + locus.partitionId   → design?partition=[partitionId]  (configure mode deep-link)
 *   SELECTION + locus.selectionId  → design?partition=[locus.partitionId]  (always has partitionId)
 *   INVENTORY + p.code             → /inventory  (generic, no deep-link into item popup)
 *   FORMULA_SET                    → no link (no user-facing locus yet)
 *   Any problem without a navigable locus → no link, show no-locus note
 *
 * No i18n dependency — copy is static and not user-authored.  Title is caller-supplied so the
 * same component can say "Design cannot be submitted" vs "Recompute failed".
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import type {
  CalculationProblem,
  CalculationProblemReport,
  ProblemScope,
} from "@/lib/materials/problems";

// ─── Scope-specific visual config ────────────────────────────────────────────

interface ScopeStyle {
  label: string;
  headerBg: string;
  headerBorder: string;
  iconBg: string;
  titleColor: string;
  rowBorderColor: string;
  dotColor: string;
  countBg: string;
  countText: string;
  countBorder: string;
}

const SCOPE_STYLES: Record<ProblemScope, ScopeStyle> = {
  DESIGN: {
    label: "Fix your design",
    headerBg: "#FEF3F0",
    headerBorder: "#F4C4BB",
    iconBg: "#D95535",
    titleColor: "#9A2E1F",
    rowBorderColor: "#F4C4BB",
    dotColor: "#D95535",
    countBg: "#FEF3F0",
    countText: "#9A2E1F",
    countBorder: "#F4C4BB",
  },
  SELECTION: {
    label: "Fill in these fields",
    headerBg: "#FFF8E6",
    headerBorder: "#F5D88C",
    iconBg: "#D4930A",
    titleColor: "#7A5200",
    rowBorderColor: "#F5D88C",
    dotColor: "#D4930A",
    countBg: "#FFF8E6",
    countText: "#7A5200",
    countBorder: "#F5D88C",
  },
  INVENTORY: {
    label: "Fix your inventory",
    headerBg: "#EDF4FF",
    headerBorder: "#B8D0F5",
    iconBg: "#2563EB",
    titleColor: "#1A3E7A",
    rowBorderColor: "#B8D0F5",
    dotColor: "#2563EB",
    countBg: "#EDF4FF",
    countText: "#1A3E7A",
    countBorder: "#B8D0F5",
  },
  FORMULA_SET: {
    label: "Fix your formula set",
    headerBg: "#F3F0FF",
    headerBorder: "#C4B5FD",
    iconBg: "#7C3AED",
    titleColor: "#3B0764",
    rowBorderColor: "#C4B5FD",
    dotColor: "#7C3AED",
    countBg: "#F3F0FF",
    countText: "#3B0764",
    countBorder: "#C4B5FD",
  },
};

/** Scope icons — SVG paths per mockup. */
function ScopeIcon({ scope }: { scope: ProblemScope }) {
  switch (scope) {
    case "DESIGN":
      return (
        <svg viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" className="h-[13px] w-[13px]">
          <path d="M6.5 2L1 11h11L6.5 2z" /><path d="M6.5 7v2" />
        </svg>
      );
    case "SELECTION":
      return (
        <svg viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" className="h-[13px] w-[13px]">
          <path d="M6.5 1v3M6.5 9v3M1 6.5h3M9 6.5h3" /><circle cx="6.5" cy="6.5" r="2.5" />
        </svg>
      );
    case "INVENTORY":
      return (
        <svg viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" className="h-[13px] w-[13px]">
          <rect x="1" y="4" width="11" height="8" rx="1" /><path d="M4 4V3a2 2 0 014 0v1" />
        </svg>
      );
    case "FORMULA_SET":
      return (
        <svg viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" className="h-[13px] w-[13px]">
          <path d="M2 3h9M2 6.5h6M2 10h4" /><path d="M10 7l2 2-2 2" />
        </svg>
      );
  }
}

/** Arrow-out icon for the Go button. */
function GoArrowIcon() {
  return (
    <svg viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="2" className="h-[11px] w-[11px] opacity-70">
      <path d="M2 9L9 2M9 2H4M9 2v5" />
    </svg>
  );
}

// ─── Link builder ─────────────────────────────────────────────────────────────

function orgPath(isSubdomain: boolean, orgSlug: string, subpath: string): string {
  return isSubdomain ? subpath : `/${orgSlug}${subpath}`;
}

// ─── Go link resolver ─────────────────────────────────────────────────────────

/**
 * Returns the href for the problem's "Go" link, or null if this problem has
 * no navigable locus (no link should be shown).
 */
function resolveGoHref(
  problem: CalculationProblem,
  orgSlug: string,
  projectId: string,
  isSubdomain: boolean,
): string | null {
  switch (problem.scope) {
    case "DESIGN": {
      const partitionId = problem.locus?.partitionId;
      if (!partitionId) return null;
      return orgPath(isSubdomain, orgSlug, `/projects/${projectId}/design?partition=${partitionId}`);
    }
    case "SELECTION": {
      // selectionId present → has a navigable partition in locus
      const partitionId = problem.locus?.partitionId;
      const selectionId = problem.locus?.selectionId;
      if (!selectionId || !partitionId) return null;
      return orgPath(isSubdomain, orgSlug, `/projects/${projectId}/design?partition=${partitionId}`);
    }
    case "INVENTORY": {
      if (!problem.code) return null;
      return orgPath(isSubdomain, orgSlug, "/inventory");
    }
    case "FORMULA_SET":
      return null;
  }
}

// ─── Problem row ──────────────────────────────────────────────────────────────

function ProblemRow({
  problem,
  orgSlug,
  projectId,
  isSubdomain,
  onClose,
  style,
}: {
  problem: CalculationProblem;
  orgSlug: string;
  projectId: string;
  isSubdomain: boolean;
  onClose: () => void;
  style: ScopeStyle;
}) {
  const href = resolveGoHref(problem, orgSlug, projectId, isSubdomain);

  // Build a human-readable locus string.
  const locus = problem.locus;
  const locusLines: string[] = [];
  if (locus) {
    const parts: string[] = [];
    if (locus.roomName) parts.push(locus.roomName);
    if (locus.partitionLabel) parts.push(locus.partitionLabel);
    if (locus.sectionIndex !== undefined && locus.cellIndex !== undefined) {
      parts.push(`Section ${locus.sectionIndex + 1}, Cell ${locus.cellIndex + 1}`);
    }
    if (parts.length > 0) locusLines.push(parts.join(" · "));
    if (locus.fieldKey) locusLines.push(locus.fieldKey);
    if (locus.componentTypeCode) locusLines.push(locus.componentTypeCode);
  }
  if (problem.code) locusLines.push(`Code: ${problem.code}`);
  if (problem.occurrenceCount && problem.occurrenceCount > 1) {
    locusLines.push(`Used in ${problem.occurrenceCount} partitions`);
  }

  return (
    <div className="flex items-start gap-[10px] border-b border-border bg-bg-white px-[14px] py-[10px] last:border-b-0 hover:bg-bg-hover">
      {/* Scope dot */}
      <div
        className="mt-[5px] h-[6px] w-[6px] flex-shrink-0 rounded-full"
        style={{ background: style.dotColor }}
      />
      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-bold leading-[1.4] text-text-heading">
          {problem.message}
        </p>
        {locusLines.length > 0 && href ? (
          <p className="mt-[2px] text-[11px] leading-[1.4] text-text-muted">
            {locusLines.map((line, i) => (
              <span key={i}>{i > 0 ? <> · </> : null}{line}</span>
            ))}
          </p>
        ) : locusLines.length > 0 ? (
          <p className="mt-[2px] text-[11px] leading-[1.4] text-text-muted">
            {locusLines.join(" · ")}
          </p>
        ) : (
          /* No locus — backlog 2026-09-23: buildSummary FAILED path */
          <p className="mt-[2px] text-[10.5px] italic leading-[1.4] text-text-muted">
            Exact location unknown — check your configuration or formula set.
          </p>
        )}
      </div>
      {/* Go link — only when navigable */}
      {href && (
        <Link
          href={href}
          onClick={onClose}
          className="mt-[1px] inline-flex flex-shrink-0 items-center gap-[4px] whitespace-nowrap rounded-[3px] border border-border bg-bg-white px-[10px] py-[5px] text-[11px] font-bold text-text-body hover:border-[var(--color-border-strong)] hover:bg-primary-softer hover:text-text-heading"
        >
          <GoArrowIcon />
          Go
        </Link>
      )}
    </div>
  );
}

// ─── Problem group ────────────────────────────────────────────────────────────

function ProblemGroup({
  scope,
  problems,
  orgSlug,
  projectId,
  isSubdomain,
  onClose,
}: {
  scope: ProblemScope;
  problems: CalculationProblem[];
  orgSlug: string;
  projectId: string;
  isSubdomain: boolean;
  onClose: () => void;
}) {
  const s = SCOPE_STYLES[scope];

  return (
    <div>
      {/* Group header */}
      <div
        className="flex items-center gap-[8px] rounded-t-[5px] border-b-0 px-[12px] py-[8px]"
        style={{
          background: s.headerBg,
          border: `1px solid ${s.headerBorder}`,
          borderBottom: "none",
        }}
      >
        {/* Icon */}
        <div
          className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[4px] text-white"
          style={{ background: s.iconBg }}
        >
          <ScopeIcon scope={scope} />
        </div>
        {/* Label */}
        <span className="text-[12.5px] font-extrabold" style={{ color: s.titleColor }}>
          {s.label}
        </span>
        {/* Count pill */}
        <span
          className="ml-auto rounded-[20px] px-[8px] py-[2px] text-[11px] font-bold"
          style={{
            background: s.countBg,
            color: s.countText,
            border: `1px solid ${s.countBorder}`,
          }}
        >
          {problems.length}
        </span>
      </div>
      {/* Rows */}
      <div
        className="overflow-hidden rounded-b-[5px]"
        style={{ border: `1px solid ${s.rowBorderColor}`, borderTop: "none" }}
      >
        {problems.map((p, i) => (
          <ProblemRow
            key={i}
            problem={p}
            orgSlug={orgSlug}
            projectId={projectId}
            isSubdomain={isSubdomain}
            onClose={onClose}
            style={s}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface ProblemPopupProps {
  report: CalculationProblemReport;
  /** "Design cannot be submitted" (Submit Design trigger) or "Recompute failed" (Recompute trigger) */
  title: string;
  orgSlug: string;
  projectId: string;
  isSubdomain: boolean;
  onClose: () => void;
}

const SCOPE_ORDER: ProblemScope[] = ["DESIGN", "SELECTION", "INVENTORY", "FORMULA_SET"];

/**
 * Problem popup — full-screen overlay dialog showing problems grouped by scope.
 *
 * Closes on Escape or clicking the overlay, X button, or footer Close button.
 * "Go" links navigate to the offending item and close the popup.
 */
export function ProblemPopup({
  report,
  title,
  orgSlug,
  projectId,
  isSubdomain,
  onClose,
}: ProblemPopupProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Auto-focus the X button when the dialog opens so Tab navigates into the content.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Dismiss on Escape.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Group problems by scope.
  const byScope = new Map<ProblemScope, CalculationProblem[]>();
  for (const p of report.problems) {
    const group = byScope.get(p.scope) ?? [];
    group.push(p);
    byScope.set(p.scope, group);
  }

  const totalCount = report.problemCount;
  const subtitle = `${totalCount} ${totalCount === 1 ? "problem" : "problems"} must be fixed`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="problem-popup-title"
        aria-describedby="problem-popup-subtitle"
        className="mx-5 flex w-full max-w-[540px] flex-col overflow-hidden rounded-[8px] border border-border bg-bg-white shadow-[0_24px_48px_-16px_rgba(27,40,30,.4)]"
        style={{ maxHeight: "calc(100vh - 80px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-start justify-between border-b border-border px-[22px] pb-[14px] pt-[18px]">
          <div>
            <h2
              id="problem-popup-title"
              className="text-[15px] font-extrabold text-text-heading"
            >
              {title}
            </h2>
            <p
              id="problem-popup-subtitle"
              className="mt-[3px] text-[12px] text-text-muted"
            >
              {subtitle}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-4 flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-[4px] border border-border bg-transparent text-text-muted hover:bg-primary-softer hover:text-text-heading"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex flex-col gap-[18px] overflow-y-auto px-[22px] py-[18px]">
          {SCOPE_ORDER.map((scope) => {
            const problems = byScope.get(scope);
            if (!problems || problems.length === 0) return null;
            return (
              <ProblemGroup
                key={scope}
                scope={scope}
                problems={problems}
                orgSlug={orgSlug}
                projectId={projectId}
                isSubdomain={isSubdomain}
                onClose={onClose}
              />
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-end border-t border-border bg-bg-card px-[22px] py-[12px]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[4px] border border-border bg-bg-white px-[18px] py-[8px] text-[13px] font-bold text-text-body hover:border-[var(--color-border-strong)] hover:text-text-heading"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
