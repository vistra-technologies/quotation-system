export interface OrgFingerprint {
  /** Organization.id — global setup compares it with the API target's ids (fixtures/target-identity.ts) */
  id?: string;
  counts: Record<string, number>;
  componentTypesHash: string;
  /** sha of the sorted (roleId, permissionId) pairs of this org's roles */
  rolePermissionsHash: string;
  /** per counted table that has updatedAt: sha of sorted {id, updatedAt} — catches edits to existing rows; Role: sha of (id, name, description) */
  rowsHash: Record<string, string>;
  /** per table: row id → version (updatedAt ISO; Role: content hash) — lets a delta name the rows that changed */
  rows?: Record<string, Record<string, string>>;
  /** sha of the Organization row (name, slug, isSuspended, activeFormulaSetId, updatedAt) */
  orgRowHash: string;
  isSuspended: boolean;
  activeFormulaSetId: string | null;
  /**
   * CONTENT hashes (never updatedAt) of the org's shared configuration. Checked for the Test Org at teardown
   * (final review I3): the suite edits and reverts these, so content must be back to the baseline exactly.
   */
  sharedConfig?: SharedConfig;
}
export interface SharedConfig {
  componentTypes: string;
  componentTypeOrgConfig: string;
  componentCategories: string;
  roles: string;
  rolePermissions: string;
  /** name, slug, isSuspended, activeFormulaSetId */
  org: string;
}
export interface Snapshot {
  takenAt: string;
  orgs: Record<string, OrgFingerprint>;
  globals: {
    formulaSetsHash: string;
    superAdmins: string[];
    permissions: string[];
  };
}

/**
 * M-a: a run that CREATES the Test Org took its baseline before the org existed, so teardown's shared-config check
 * would always report "not in the baseline". Fold the freshly created org's fingerprint into the baseline — only when
 * the baseline lacks it (an existing baseline entry is never overwritten).
 */
export function withOrgBaseline(baseline: Snapshot, fresh: Snapshot, slug: string): Snapshot {
  if (baseline.orgs[slug]) return baseline;
  const f = fresh.orgs[slug];
  if (!f) throw new Error(`baseline: org "${slug}" is in neither the baseline nor the fresh snapshot`);
  return { ...baseline, orgs: { ...baseline.orgs, [slug]: f } };
}

/** " — added [..] removed [..] changed [..]" (ids, at most 10 each) when both sides carry per-row versions, else "". */
export function changedRows(before: Record<string, string> | undefined, after: Record<string, string> | undefined): string {
  if (!before || !after) return "";
  const cap = (ids: string[]) => (ids.length > 10 ? [...ids.slice(0, 10), `…+${ids.length - 10}`] : ids).join(", ");
  const added = Object.keys(after).filter((id) => !(id in before));
  const removed = Object.keys(before).filter((id) => !(id in after));
  const changed = Object.keys(after).filter((id) => id in before && before[id] !== after[id]);
  const parts = [
    added.length ? `added [${cap(added)}]` : "",
    removed.length ? `removed [${cap(removed)}]` : "",
    changed.length ? `changed [${cap(changed)}]` : "",
  ].filter(Boolean);
  return parts.length ? ` — ${parts.join("; ")}` : "";
}

/** Human-readable differences between two snapshots; [] means nothing outside `ignoreOrg` changed. */
export function diffSnapshots(before: Snapshot, after: Snapshot, ignoreOrg: (slug: string) => boolean): string[] {
  const out: string[] = [];
  const slugs = new Set([...Object.keys(before.orgs), ...Object.keys(after.orgs)]);
  for (const slug of [...slugs].sort()) {
    if (ignoreOrg(slug)) continue;
    const b = before.orgs[slug];
    const a = after.orgs[slug];
    if (b && !a) { out.push(`org "${slug}" disappeared`); continue; }
    if (!b && a) { out.push(`org "${slug}" appeared`); continue; }
    for (const table of new Set([...Object.keys(b.counts), ...Object.keys(a.counts)])) {
      if ((b.counts[table] ?? 0) !== (a.counts[table] ?? 0)) {
        out.push(`org "${slug}": ${table} count ${b.counts[table] ?? 0} → ${a.counts[table] ?? 0}`);
      }
    }
    for (const table of new Set([...Object.keys(b.rowsHash ?? {}), ...Object.keys(a.rowsHash ?? {})])) {
      if (b.rowsHash?.[table] !== a.rowsHash?.[table]) out.push(`org "${slug}": ${table} rows modified${changedRows(b.rows?.[table], a.rows?.[table])}`);
    }
    if (b.orgRowHash !== a.orgRowHash) out.push(`org "${slug}": org row modified`);
    for (const k of ["componentTypesHash", "rolePermissionsHash", "isSuspended", "activeFormulaSetId"] as const) {
      if (b[k] !== a[k]) out.push(`org "${slug}": ${k} ${JSON.stringify(b[k])} → ${JSON.stringify(a[k])}`);
    }
  }
  const g = (k: keyof Snapshot["globals"]) => JSON.stringify(before.globals[k]) !== JSON.stringify(after.globals[k]);
  for (const k of ["formulaSetsHash", "superAdmins", "permissions"] as const) {
    if (g(k)) out.push(`global ${k}: ${JSON.stringify(before.globals[k])} → ${JSON.stringify(after.globals[k])}`);
  }
  return out;
}

/**
 * The Test Org's shared configuration must be byte-identical (content, not updatedAt) after teardown to what it was
 * at the baseline: every suite edit (GLASS/DOOR rename windows, config values, role permissions, formula-set pins)
 * is reverted. Names each hash that changed; [] = restored. A missing org or missing sharedConfig is reported too.
 */
export function diffSharedConfig(slug: string, before: OrgFingerprint | undefined, after: OrgFingerprint | undefined): string[] {
  if (!before || !after) return [`org "${slug}" ${before ? "disappeared" : "was not in the baseline"} — shared config not comparable`];
  if (!before.sharedConfig || !after.sharedConfig) return [`org "${slug}": snapshot carries no sharedConfig — shared config not comparable`];
  const out: string[] = [];
  for (const k of Object.keys(before.sharedConfig) as (keyof SharedConfig)[]) {
    if (before.sharedConfig[k] !== after.sharedConfig[k]) {
      out.push(`org "${slug}": shared config ${k} changed (${before.sharedConfig[k]} → ${after.sharedConfig[k]}) — a suite edit was not reverted exactly`);
    }
  }
  return out;
}
