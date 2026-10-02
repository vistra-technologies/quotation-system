"use client";

import { Fragment, useState } from "react";
import type { AuditEntry } from "@/lib/data/superadmin/audit-log";

// Expandable rows for /controls/audit-log (hotfix 2026-10-02). Client component only because rows
// expand and timestamps render in the viewer's local timezone (cells use suppressHydrationWarning —
// the server renders UTC, the browser re-renders local).

const VERB_CLS: Record<string, string> = {
  INSERT: "bg-status-success-bg text-status-success-text",
  UPDATE: "bg-status-pending-bg text-status-pending-text",
  DELETE: "bg-status-failed-bg text-status-failed-text",
};

function when(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  };
}

export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const th = "px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Audit entries">
        <thead>
          <tr className="border-b border-border">
            <th className="w-5 px-4 py-3.5" />
            <th className={th}>When</th>
            <th className={th}>By</th>
            <th className={th}>Action</th>
            <th className={th}>Item</th>
            <th className={th}>Entity</th>
            <th className={th}>Scope</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const w = when(e.createdAt);
            const isOpen = open.has(e.id);
            const entity = e.entity ?? `${e.item} ${e.targetId.slice(0, 8)}…`;
            return (
              <Fragment key={e.id}>
                <tr
                  data-testid="audit-row"
                  className="cursor-pointer border-b border-border hover:bg-primary-softer/20"
                  onClick={() => toggle(e.id)}
                >
                  <td className="px-4 py-3 align-top text-text-placeholder">
                    <button type="button" aria-expanded={isOpen} aria-label={isOpen ? "Hide details" : "Show details"}
                      onClick={(ev) => { ev.stopPropagation(); toggle(e.id); }}
                      className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>
                      ›
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 align-top" suppressHydrationWarning>
                    {w.date}
                    <span className="block text-xs text-text-muted" suppressHydrationWarning>{w.time}</span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {e.by.username === null ? (
                      <span className="italic text-text-placeholder">unknown</span>
                    ) : e.by.deleted ? (
                      <span className="font-semibold italic text-text-placeholder">{e.by.username} (deleted)</span>
                    ) : (
                      <b className="text-text-heading">{e.by.username}</b>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={`inline-block min-w-[68px] rounded-[6px] px-2 py-0.5 text-center text-[11.5px] font-extrabold tracking-wider ${VERB_CLS[e.verb]}`}>
                      {e.verb}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 align-top font-bold text-text-heading">{e.item}</td>
                  <td className="px-4 py-3 align-top">
                    <b className="text-[14.5px] text-text-heading">{entity}</b>
                    <span className="mt-0.5 block text-xs text-text-muted">{e.summary}</span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {e.org ? (
                      <span className="whitespace-nowrap rounded-pill bg-status-shipped-bg px-2 py-0.5 text-xs font-bold text-status-shipped-text">
                        {e.org.slug ?? e.org.id}
                      </span>
                    ) : (
                      <span className="whitespace-nowrap rounded-pill bg-primary-softer px-2 py-0.5 text-xs font-bold text-primary-dark">
                        SuperAdmin console
                      </span>
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr data-testid="audit-detail" className="border-b border-border bg-bg-white">
                    <td />
                    <td colSpan={6} className="px-4 pb-4 pt-1">
                      <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                        <dt className="font-bold text-text-muted">What happened</dt>
                        <dd className="text-text-heading">{e.verb} {e.item} “{entity}” — {e.summary}</dd>
                        <dt className="font-bold text-text-muted">Scope</dt>
                        <dd className="text-text-heading">
                          {e.org ? `Organization — ${e.org.slug ?? e.org.id}` : "SuperAdmin console (platform-level)"}
                        </dd>
                        <dt className="font-bold text-text-muted">Raw action</dt>
                        <dd className="font-mono text-xs text-text-heading">{e.action}</dd>
                        <dt className="font-bold text-text-muted">Target</dt>
                        <dd className="font-mono text-xs text-text-heading">{e.targetType} · {e.targetId}</dd>
                        <dt className="font-bold text-text-muted">Details</dt>
                        <dd>
                          <pre className="overflow-auto rounded-sm border border-border bg-bg-page px-3 py-2 text-xs">
                            {JSON.stringify(e.details ?? {}, null, 2)}
                          </pre>
                        </dd>
                      </dl>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
