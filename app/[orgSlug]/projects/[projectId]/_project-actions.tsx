"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadingOverlay } from "@/components/loading-overlay";

interface ProjectActionsProps {
  orgSlug: string;
  projectId: string;
  /** e.g. "JOB-12 · Marina Tower" — shown in both confirm dialogs. */
  projectLabel: string;
  /** Org-aware href of the Projects list (redirect target after delete). */
  projectsHref: string;
}

type Pending = "delete" | "reset" | null;

/**
 * Delete / Reset buttons for the Project Details footer (hotfix 2026-09-25, H-2/H-3).
 *
 * Rendered by page.tsx for DRAFT projects only; both API routes re-check DRAFT
 * inside their transaction and answer 409 otherwise.
 *   Delete → DELETE /api/v1/orgs/[orgSlug]/projects/[projectId] → Projects list.
 *   Reset  → POST   /api/v1/orgs/[orgSlug]/projects/[projectId]/reset → refresh
 *            (the wizard pills re-lock because selections/partitions/designSubmittedAt reset).
 *
 * Plain English strings, like the rest of this page's footer — no next-intl namespace wiring.
 */
export function ProjectActions({ orgSlug, projectId, projectLabel, projectsHref }: ProjectActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(null);
    setError(null);
  }

  async function run(kind: "delete" | "reset") {
    if (busy) return;
    setBusy(true);
    setError(null);
    const base = `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectId)}`;
    try {
      const res =
        kind === "delete"
          ? await fetch(base, { method: "DELETE" })
          : await fetch(`${base}/reset`, { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `${kind === "delete" ? "Delete" : "Reset"} failed (HTTP ${res.status})`);
        setBusy(false);
        return;
      }
      setOpen(null);
      if (kind === "delete") {
        // Keep the overlay up through navigation — the page is gone.
        router.push(projectsHref);
        router.refresh();
      } else {
        router.refresh();
        setBusy(false);
      }
    } catch {
      setError("Network error — please try again");
      setBusy(false);
    }
  }

  const btnClass =
    "inline-flex items-center gap-1.5 rounded-sm border border-[var(--color-danger-border)] bg-bg-white px-4 py-2.5 text-sm font-bold text-[var(--color-status-failed-text)] hover:bg-[var(--color-danger-bg)] disabled:opacity-50";

  return (
    <>
      <LoadingOverlay visible={busy} />

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnClass} disabled={busy} onClick={() => setOpen("delete")}>
          Delete project
        </button>
        <button type="button" className={btnClass} disabled={busy} onClick={() => setOpen("reset")}>
          Reset project
        </button>
      </div>

      <ConfirmDialog
        isOpen={open === "delete"}
        title="Delete project?"
        message={
          <>
            <p className="mb-2">
              <strong>{projectLabel}</strong> will be permanently deleted, including:
            </p>
            <ul className="list-disc pl-5">
              <li>all configured components</li>
              <li>all floors, rooms and partitions</li>
              <li>the summary / material list</li>
            </ul>
          </>
        }
        errorMessage={error}
        confirmLabel="Delete project"
        onConfirm={() => run("delete")}
        onCancel={close}
      />

      <ConfirmDialog
        isOpen={open === "reset"}
        title="Reset project?"
        message={
          <>
            <p className="mb-2">
              This erases everything after Project Details for <strong>{projectLabel}</strong>:
            </p>
            <ul className="list-disc pl-5">
              <li>configured components</li>
              <li>all floors, rooms and partitions (design)</li>
              <li>the summary / material list and quotation data</li>
            </ul>
          </>
        }
        errorMessage={error}
        confirmLabel="Reset project"
        onConfirm={() => run("reset")}
        onCancel={close}
      />
    </>
  );
}
