"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SelectField } from "@/components/select-field";
import { AUDIT_VERBS, TEST_ACCOUNT_USERNAME, type AuditScope } from "@/lib/superadmin-audit-view";

// Filter bar for /controls/audit-log (hotfix 2026-10-02). All state lives in the URL query string, so a
// filtered view is linkable and the server page stays the single source of truth. No i18n and no shared
// LoadingOverlay — /controls has no NextIntlClientProvider (AGENTS.md).

export interface FilterValues {
  scope: AuditScope;
  orgId: string;
  by: string;
  verb: string;
  item: string;
  from: string;
  to: string;
  hideTest: boolean;
}

interface Facets {
  orgs: { id: string; slug: string | null }[];
  admins: { username: string; deleted: boolean }[];
  items: string[];
}

const inputCls =
  "min-w-[170px] rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]";
const labelCls = "mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted";

const SCOPES: { value: AuditScope; label: string }[] = [
  { value: "all", label: "All" },
  { value: "platform", label: "SuperAdmin console" },
  { value: "org", label: "Organization" },
];

export function AuditFilters({ current, facets }: { current: FilterValues; facets: Facets }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function apply(next: Partial<FilterValues>) {
    const merged: FilterValues = { ...current, ...next };
    // The org filter only makes sense in Organization scope.
    if (merged.scope !== "org") merged.orgId = "";
    const params = new URLSearchParams();
    if (merged.scope !== "all") params.set("scope", merged.scope);
    for (const k of ["orgId", "by", "verb", "item", "from", "to"] as const) {
      if (merged[k]) params.set(k, merged[k]);
    }
    if (merged.hideTest) params.set("hideTest", "1");
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname)); // any filter change resets to page 1
  }

  const hasAny =
    current.scope !== "all" || !!(current.orgId || current.by || current.verb || current.item || current.from || current.to) || current.hideTest;

  return (
    <section
      aria-label="Filters"
      className={`mt-5 flex flex-col gap-4 rounded-md border border-border bg-bg-card p-4 shadow-card ${isPending ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <span className={labelCls}>Scope</span>
          <div role="group" aria-label="Scope" className="inline-flex overflow-hidden rounded-sm border border-border bg-bg-white">
            {SCOPES.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-pressed={current.scope === s.value}
                onClick={() => apply({ scope: s.value })}
                className={`border-r border-border px-4 py-2 text-sm font-bold last:border-r-0 ${
                  current.scope === s.value
                    ? "bg-primary text-text-on-primary"
                    : "text-text-body hover:bg-primary-softer"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="audit-org" className={labelCls}>Organization</label>
          <SelectField
            id="audit-org"
            className={inputCls}
            value={current.orgId}
            disabled={current.scope !== "org"}
            onChange={(e) => apply({ orgId: e.target.value })}
          >
            <option value="">All organizations</option>
            {facets.orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.slug ?? o.id}</option>
            ))}
          </SelectField>
        </div>

        <div>
          <label htmlFor="audit-by" className={labelCls}>By</label>
          <SelectField id="audit-by" className={inputCls} value={current.by} onChange={(e) => apply({ by: e.target.value })}>
            <option value="">Anyone</option>
            {facets.admins.map((a) => (
              <option key={a.username} value={a.username}>
                {a.deleted ? `${a.username} (deleted)` : a.username}
              </option>
            ))}
          </SelectField>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="audit-verb" className={labelCls}>Action</label>
          <SelectField id="audit-verb" className={inputCls} value={current.verb} onChange={(e) => apply({ verb: e.target.value })}>
            <option value="">Any action</option>
            {AUDIT_VERBS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </SelectField>
        </div>
        <div>
          <label htmlFor="audit-item" className={labelCls}>Item</label>
          <SelectField id="audit-item" className={inputCls} value={current.item} onChange={(e) => apply({ item: e.target.value })}>
            <option value="">Any item</option>
            {facets.items.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </SelectField>
        </div>
        <div>
          <label htmlFor="audit-from" className={labelCls}>From</label>
          <input id="audit-from" type="date" className={inputCls} value={current.from} max={current.to || undefined}
            onChange={(e) => apply({ from: e.target.value })} />
        </div>
        <div>
          <label htmlFor="audit-to" className={labelCls}>To</label>
          <input id="audit-to" type="date" className={inputCls} value={current.to} min={current.from || undefined}
            onChange={(e) => apply({ to: e.target.value })} />
        </div>
        <label htmlFor="audit-hide-test" className="flex cursor-pointer items-center gap-2 py-2 text-sm text-text-body">
          <input
            id="audit-hide-test"
            type="checkbox"
            checked={current.hideTest}
            onChange={(e) => apply({ hideTest: e.target.checked })}
            className="h-4 w-4 accent-[var(--color-primary)]"
          />
          Hide {TEST_ACCOUNT_USERNAME} activity
        </label>
        <button
          type="button"
          disabled={!hasAny}
          onClick={() => startTransition(() => router.push(pathname))}
          className="rounded-sm border border-border bg-bg-white px-3.5 py-2 text-sm font-bold text-text-body hover:border-[#b9c2ae] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset filters
        </button>
      </div>
    </section>
  );
}
