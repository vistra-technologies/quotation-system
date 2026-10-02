"use client";

import { useMemo, useState } from "react";
import {
  diffFormulaSetBodies,
  formatValue,
  highlightChange,
  type BodyDiff,
  type BodyDiffOk,
  type FormulaDiff,
} from "@/lib/formula-set/diff";

interface VersionDiffProps {
  /** Raw JSON of the version this draft was started from. */
  baseJson: string;
  /** Live textarea contents. */
  draftJson: string;
  /** Version number of the base, for labels ("Changes vs v1"). */
  baseVersion: number;
}

const KIND_CHIP: Record<FormulaDiff["kind"], string> = {
  changed: "bg-status-pending-bg text-status-pending-text",
  added: "bg-status-paid-bg text-status-paid-text",
  removed: "bg-status-failed-bg text-status-failed-text",
};

/**
 * "Changes vs vN" panel for the SuperAdmin new-version draft page (Client Component).
 *
 * Hotfix 2026-10-02, item 5. Recomputes on every keystroke from the textarea text — no API, no DB.
 * Invalid JSON mid-edit keeps the last good diff on screen, greyed out, under a "fix the JSON" notice.
 * Mockup: design-docs/mockups/formula-version-diff-poc.html.
 *
 * Like the form around it, deliberately avoids next-intl (no provider under /controls).
 */
export function VersionDiff({ baseJson, draftJson, baseVersion }: VersionDiffProps) {
  const diff: BodyDiff = useMemo(() => diffFormulaSetBodies(baseJson, draftJson), [baseJson, draftJson]);

  // "Adjust state while rendering": remember the last successful diff so a typo does not blank the panel.
  const [lastGood, setLastGood] = useState<BodyDiffOk | null>(null);
  if (diff.ok && diff !== lastGood) setLastGood(diff);

  const shown: BodyDiffOk | null = diff.ok ? diff : lastGood;
  const vs = `v${baseVersion}`;

  return (
    <section
      aria-label={`Changes vs ${vs}`}
      className="mb-4 rounded-md border border-border bg-bg-card px-4 py-4"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-extrabold text-text-heading">Changes vs {vs}</h2>
        {shown && (
          <>
            <Chip className={KIND_CHIP.changed}>{shown.counts.changed} changed</Chip>
            <Chip className={KIND_CHIP.added}>{shown.counts.added} added</Chip>
            <Chip className={KIND_CHIP.removed}>{shown.counts.removed} removed</Chip>
            <Chip className="bg-bg-hover text-text-muted">{shown.counts.unchanged} unchanged</Chip>
          </>
        )}
      </div>

      {!diff.ok && (
        <p
          role="status"
          className="mb-3 rounded-sm border border-border bg-primary-softer px-3 py-2 text-xs font-semibold text-text-body"
        >
          {diff.side === "base"
            ? `The ${vs} body could not be read, so no comparison is possible: ${diff.message}`
            : `Fix the JSON to see changes. ${shown ? "Showing the last valid comparison." : ""} (${diff.message})`}
        </p>
      )}

      {shown && (
        <div className={diff.ok ? undefined : "opacity-50"} aria-hidden={diff.ok ? undefined : true}>
          <DiffBody diff={shown} vs={vs} />
        </div>
      )}
    </section>
  );
}

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${className}`}>{children}</span>;
}

function DiffBody({ diff, vs }: { diff: BodyDiffOk; vs: string }) {
  if (diff.identical) {
    return <p className="text-sm text-text-muted">No changes vs {vs}.</p>;
  }
  const structureClean = diff.slots.length === 0 && diff.other.length === 0;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-sm border border-border bg-primary-softer px-3 py-2 text-xs text-text-body">
        {structureClean ? (
          <>
            Slots and <code className="font-mono">requiredParams</code>: <b>no changes</b>. Formulas are matched by{" "}
            <code className="font-mono">id</code>, so reordering is not reported as a change.
          </>
        ) : (
          <ul className="flex flex-col gap-1">
            {diff.slots.map(s => (
              <li key={s.slot}>
                <b>Slot {s.slot}</b> <span className="text-text-muted">({s.kind})</span>
                <ul className="ml-4 list-disc font-mono text-[11px]">
                  {s.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </li>
            ))}
            {diff.other.map(o => (
              <li key={o.field}>
                <b>{o.field}</b>: <span className="font-mono">{formatValue(o.before)}</span> →{" "}
                <span className="font-mono">{formatValue(o.after)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {diff.formulas.map(f => (
        <FormulaCard key={`${f.kind}:${f.id}`} f={f} />
      ))}

      {diff.unchangedIds.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-bold text-text-muted">
            {diff.unchangedIds.length} unchanged formula{diff.unchangedIds.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {diff.unchangedIds.map(id => (
              <span key={id} className="rounded-sm bg-bg-hover px-2 py-0.5 font-mono text-[11px] text-text-muted">
                {id}
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function FormulaCard({ f }: { f: FormulaDiff }) {
  const meta = [f.meta.slot, f.meta.grain, f.meta.unit].filter(Boolean).join(" · ");
  return (
    <div className="overflow-hidden rounded-sm border border-border bg-bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-softer px-3 py-2">
        <span className="text-sm font-extrabold text-text-heading">{f.id}</span>
        <Chip className={KIND_CHIP[f.kind]}>{f.kind}</Chip>
        {meta && <span className="ml-auto text-xs text-text-muted">{meta}</span>}
      </div>
      <div className="divide-y divide-border">
        {f.fields.map(c => (
          <div key={c.field} className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[100px_minmax(0,1fr)] sm:gap-2.5">
            <div className="pt-1 text-xs font-bold text-text-muted">{c.field}</div>
            <FieldChangeView kind={f.kind} before={c.before} after={c.after} />
          </div>
        ))}
      </div>
    </div>
  );
}

const OLD = "block rounded-sm bg-status-failed-bg px-2 py-0.5 text-status-failed-text";
const NEW = "block rounded-sm bg-status-paid-bg px-2 py-0.5 text-status-paid-text";
const MARK = "rounded-[3px] bg-black/15 px-0.5 font-bold";

function FieldChangeView({ kind, before, after }: { kind: FormulaDiff["kind"]; before: unknown; after: unknown }) {
  const hasBefore = before !== undefined && kind !== "added";
  const hasAfter = after !== undefined && kind !== "removed";
  const b = formatValue(before);
  const a = formatValue(after);
  const both = hasBefore && hasAfter;
  const h = both ? highlightChange(b, a) : null;

  return (
    <div className="flex min-w-0 flex-col gap-1 break-words font-mono text-xs leading-relaxed">
      {hasBefore && (
        <span className={OLD}>
          <span aria-hidden="true">− </span>
          <span className="sr-only">Before: </span>
          {h ? (
            <>
              {h.prefix}
              {h.beforeMid && <mark className={`${MARK} text-inherit`}>{h.beforeMid}</mark>}
              {h.suffix}
            </>
          ) : (
            b
          )}
        </span>
      )}
      {hasAfter && (
        <span className={NEW}>
          <span aria-hidden="true">+ </span>
          <span className="sr-only">After: </span>
          {h ? (
            <>
              {h.prefix}
              {h.afterMid && <mark className={`${MARK} text-inherit`}>{h.afterMid}</mark>}
              {h.suffix}
            </>
          ) : (
            a
          )}
        </span>
      )}
    </div>
  );
}
