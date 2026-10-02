export interface OrgFingerprint {
  counts: Record<string, number>;
  componentTypesHash: string;
  isSuspended: boolean;
  activeFormulaSetId: string | null;
}
export interface Snapshot {
  takenAt: string;
  orgs: Record<string, OrgFingerprint>;
  globals: {
    formulaSetsHash: string;
    superAdmins: string[];
    permissions: string[];
    rolePermissionsHash: string;
  };
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
    for (const k of ["componentTypesHash", "isSuspended", "activeFormulaSetId"] as const) {
      if (b[k] !== a[k]) out.push(`org "${slug}": ${k} ${JSON.stringify(b[k])} → ${JSON.stringify(a[k])}`);
    }
  }
  const g = (k: keyof Snapshot["globals"]) => JSON.stringify(before.globals[k]) !== JSON.stringify(after.globals[k]);
  for (const k of ["formulaSetsHash", "superAdmins", "permissions", "rolePermissionsHash"] as const) {
    if (g(k)) out.push(`global ${k}: ${JSON.stringify(before.globals[k])} → ${JSON.stringify(after.globals[k])}`);
  }
  return out;
}
