/**
 * Re-runnable backfill of the SuperAdminAuditLog snapshot columns added by migrations
 * 20261002000001_superadmin_audit_username_snapshot and 20261002000002_audit_log_org_and_labels:
 *   superAdminUsername, organizationId, organizationSlug, targetLabel.
 *
 * The migrations backfill these once, in SQL, at deploy. This script is the safety net + verification tool:
 * it fills rows the in-migration SQL missed or could not resolve (e.g. a row written by the OLD code between
 * the migration and the new deploy going live, or a target that was still present on a later pass), and its
 * dry-run is the human's re-verification report.
 *
 * SANCTIONED EXCEPTION to "SuperAdminAuditLog is append-only". Application code never UPDATEs this table
 * (see the comment above the model in schema.prisma). This script is the one exception, and it is
 * backfill-only: it touches ONLY these four columns, ONLY where the column is currently NULL, and never any
 * other column (action/targetType/targetId/metadata/createdAt/superAdminId are never written). No DB trigger
 * or rule blocks UPDATE on the table (checked: none in prisma/migrations); the append-only rule is purely a
 * code convention.
 *
 * Derivation = the audit writer's (lib/data/superadmin/audit.ts), so backfilled rows match newly written ones:
 *   - organizationId   : lib/superadmin-audit-view `deriveOrganizationId` (Organization target => targetId, else
 *                        metadata.organizationId ?? metadata.orgId). If nothing derives, the row is PLATFORM
 *                        scope (NULL means platform on the audit-log page) and is left NULL on purpose — it is
 *                        never "guessed" (e.g. from the target's current owner), because a wrong org would
 *                        misclassify the row and a legitimately-platform row must stay NULL.
 *   - organizationSlug : the org's live slug; for Organization targets whose org is gone, metadata.slug.
 *                        Only filled when the row has an organizationId (stored or just derived).
 *   - targetLabel      : the target's live display name (Organization slug, User username, Role name,
 *                        FormulaSet "name vN", ComponentType code, SuperAdmin username), else
 *                        `labelFromMetadata`. NULL => the page falls back to item + short id; left as is.
 *   - superAdminUsername: SuperAdmin.username via superAdminId. A row whose admin was already deleted
 *                        (superAdminId NULL) is unrecoverable and left NULL.
 *
 * Safety (mirrors prisma/backfill-config-snapshots.ts):
 *   - DRY RUN IS THE DEFAULT. Rows are written only when `--write` is passed; `--dry-run` and npm's own
 *     `--dry-run` config always win. npm swallows unknown flags placed before `--`, so `--write` must come
 *     after it.
 *   - Fail-closed destination guard (prisma/db-target-guard.ts): dev Neon endpoint by default; production only
 *     with EXPECT_ENDPOINT=ep-little-paper-aipm0o0i set in the operator's own shell AND equal to the URL's
 *     endpoint. Production runs print "*** PRODUCTION ***". Only with human go-ahead.
 *   - Only rows with at least one NULL target column are read, and each column write is a conditional
 *     updateMany (`WHERE id = ? AND <col> IS NULL`): a non-NULL value is never overwritten, and a column
 *     filled mid-run is counted as skipped.
 *   - One row failing does not stop the run; failures are listed and the exit code is non-zero.
 *   - Idempotent: a second --write run finds nothing fillable and writes nothing.
 *
 * Usage (from quotation-system/):
 *   npm run backfill:audit-log                 # dry run (default): report + sample of would-be changes
 *   npm run backfill:audit-log -- --write      # real run (production only with human go-ahead)
 */
import dotenv from "dotenv";
import { describeTarget, enforceDbTarget } from "./db-target-guard";
import { deriveOrganizationId, labelFromMetadata } from "../lib/superadmin-audit-view";

// Same precedence as Next: real env > .env.local > .env (dotenv never overrides an already-set var).
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

export const COLUMNS = ["superAdminUsername", "organizationId", "organizationSlug", "targetLabel"] as const;
export type Column = (typeof COLUMNS)[number];

export interface AuditRow {
  id: string;
  superAdminId: string | null;
  targetType: string;
  targetId: string;
  metadata: unknown;
  superAdminUsername: string | null;
  organizationId: string | null;
  organizationSlug: string | null;
  targetLabel: string | null;
}

/** Live lookups, pre-loaded in bulk. A missing key means "the row no longer exists". */
export interface Lookups {
  adminUsernameById: ReadonlyMap<string, string>;
  orgSlugById: ReadonlyMap<string, string>;
  /** key = `${targetType}:${targetId}` -> current display name */
  liveLabel: ReadonlyMap<string, string>;
}

export interface Plan {
  /** column -> value to write (only columns that are NULL on the row AND derivable) */
  fill: Partial<Record<Column, string>>;
  /** column -> why it stays NULL (only columns that are NULL on the row and not derivable) */
  remains: Partial<Record<Column, string>>;
}

function metaObject(m: unknown): Record<string, unknown> | null {
  return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : null;
}

/** Pure: what to write for one row, and why the rest stays NULL. Never plans a write to a non-NULL column. */
export function planRow(row: AuditRow, lk: Lookups): Plan {
  const fill: Plan["fill"] = {};
  const remains: Plan["remains"] = {};
  const meta = metaObject(row.metadata);

  // superAdminUsername
  if (row.superAdminUsername === null) {
    const u = row.superAdminId ? lk.adminUsernameById.get(row.superAdminId) : undefined;
    if (u) fill.superAdminUsername = u;
    else remains.superAdminUsername = row.superAdminId ? "SuperAdmin row not found" : "SuperAdmin deleted before the snapshot existed";
  }

  // organizationId — NULL is legitimate platform scope; fill only when the writer's derivation yields one.
  let orgId = row.organizationId;
  if (orgId === null) {
    const derived = deriveOrganizationId(row.targetType, row.targetId, meta);
    if (derived) {
      fill.organizationId = derived;
      orgId = derived;
    } else {
      remains.organizationId = "platform scope (no org derivable from target/metadata) — NULL is correct";
    }
  }

  // organizationSlug — only meaningful when the row has an org (stored or just derived).
  if (row.organizationSlug === null) {
    if (orgId === null) {
      remains.organizationSlug = "no organization (platform scope)";
    } else {
      const live = lk.orgSlugById.get(orgId);
      const metaSlug = row.targetType === "Organization" && typeof meta?.slug === "string" && meta.slug.trim() ? meta.slug.trim() : null;
      const slug = live ?? metaSlug;
      if (slug) fill.organizationSlug = slug;
      else remains.organizationSlug = "organization deleted and no slug saved in metadata";
    }
  }

  // targetLabel — live row first, then what the writer saved in metadata.
  if (row.targetLabel === null) {
    const label = lk.liveLabel.get(`${row.targetType}:${row.targetId}`) ?? labelFromMetadata(meta);
    if (label) fill.targetLabel = label;
    else remains.targetLabel = "target deleted/unknown type and no name in metadata (page shows item + short id)";
  }

  return { fill, remains };
}

const CHUNK = 500;
async function chunked<T>(ids: string[], fn: (slice: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fn(ids.slice(i, i + CHUNK))));
  return out;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const target = enforceDbTarget();
  const dryRun =
    !process.argv.includes("--write") ||
    process.argv.includes("--dry-run") ||
    process.env.npm_config_dry_run === "true";

  // Loaded only after the guard, so a refused run never constructs a client.
  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  console.log(describeTarget(target));
  console.log(
    dryRun
      ? "DRY RUN — nothing will be written. (Pass `-- --write` to write.)"
      : "REAL RUN (--write) — NULL snapshot columns will be filled.",
  );

  const scanned: Record<Column, number> = { superAdminUsername: 0, organizationId: 0, organizationSlug: 0, targetLabel: 0 };
  const fillable: Record<Column, number> = { ...scanned };
  const written: Record<Column, number> = { ...scanned };
  const skippedConcurrent: Record<Column, number> = { ...scanned };
  const stillNull: Record<Column, number> = { ...scanned };
  const stillNullWhy = new Map<string, number>(); // `${column}: ${reason}` -> count
  const stillNullSamples = new Map<string, string[]>();
  const sample: string[] = [];
  const failures: string[] = [];
  let totalRows = 0;
  let candidateRows = 0;
  let aborted = false;

  try {
    totalRows = await prisma.superAdminAuditLog.count();
    // superadmin-only — intentionally cross-org
    const rows = (await prisma.superAdminAuditLog.findMany({
      where: { OR: COLUMNS.map((c) => ({ [c]: null })) },
      select: {
        id: true, superAdminId: true, targetType: true, targetId: true, metadata: true,
        superAdminUsername: true, organizationId: true, organizationSlug: true, targetLabel: true,
      },
      orderBy: { createdAt: "asc" },
    })) as AuditRow[];
    candidateRows = rows.length;

    // ── Bulk live lookups (only the ids the candidate rows can need) ────────────────────────────
    const adminIds = [...new Set(rows.map((r) => r.superAdminId).filter((x): x is string => !!x))];
    const idsOf = (type: string) => [...new Set(rows.filter((r) => r.targetType === type).map((r) => r.targetId))];
    // Orgs: Organization targets, plus any org id already stored or derivable from metadata.
    const orgIds = new Set<string>(idsOf("Organization"));
    for (const r of rows) {
      const o = r.organizationId ?? deriveOrganizationId(r.targetType, r.targetId, metaObject(r.metadata));
      if (o) orgIds.add(o);
    }

    const adminUsernameById = new Map<string, string>();
    for (const a of await chunked(adminIds, (s) => prisma.superAdmin.findMany({ where: { id: { in: s } }, select: { id: true, username: true } })))
      adminUsernameById.set(a.id, a.username);
    const orgSlugById = new Map<string, string>();
    for (const o of await chunked([...orgIds], (s) => prisma.organization.findMany({ where: { id: { in: s } }, select: { id: true, slug: true } })))
      orgSlugById.set(o.id, o.slug);

    const liveLabel = new Map<string, string>();
    for (const o of orgSlugById) if (idsOf("Organization").includes(o[0])) liveLabel.set(`Organization:${o[0]}`, o[1]);
    for (const u of await chunked(idsOf("User"), (s) => prisma.user.findMany({ where: { id: { in: s } }, select: { id: true, username: true } })))
      if (u.username) liveLabel.set(`User:${u.id}`, u.username);
    for (const r of await chunked(idsOf("Role"), (s) => prisma.role.findMany({ where: { id: { in: s } }, select: { id: true, name: true } })))
      liveLabel.set(`Role:${r.id}`, r.name);
    for (const f of await chunked(idsOf("FormulaSet"), (s) => prisma.formulaSet.findMany({ where: { id: { in: s } }, select: { id: true, name: true, version: true } })))
      liveLabel.set(`FormulaSet:${f.id}`, `${f.name} v${f.version}`);
    for (const c of await chunked(idsOf("ComponentType"), (s) => prisma.componentType.findMany({ where: { id: { in: s } }, select: { id: true, code: true } })))
      liveLabel.set(`ComponentType:${c.id}`, c.code);
    for (const a of await chunked(idsOf("SuperAdmin"), (s) => prisma.superAdmin.findMany({ where: { id: { in: s } }, select: { id: true, username: true } })))
      liveLabel.set(`SuperAdmin:${a.id}`, a.username);

    const lookups: Lookups = { adminUsernameById, orgSlugById, liveLabel };

    for (const row of rows) {
      const plan = planRow(row, lookups);
      const nullCols = COLUMNS.filter((c) => row[c] === null);
      for (const c of nullCols) scanned[c]++;
      for (const [c, why] of Object.entries(plan.remains) as [Column, string][]) {
        stillNull[c]++;
        const key = `${c}: ${why}`;
        stillNullWhy.set(key, (stillNullWhy.get(key) ?? 0) + 1);
        const s = stillNullSamples.get(key) ?? [];
        if (s.length < 3) s.push(`${row.id} (${row.targetType})`);
        stillNullSamples.set(key, s);
      }
      const fills = Object.entries(plan.fill) as [Column, string][];
      for (const [c] of fills) fillable[c]++;
      if (fills.length === 0) continue;
      if (sample.length < 10) {
        sample.push(`${row.id} [${row.targetType}] ` + fills.map(([c, v]) => `${c}=${JSON.stringify(v)}`).join(" "));
      }
      if (dryRun) continue;

      try {
        for (const [c, v] of fills) {
          // Conditional on the column still being NULL: never overwrites a value that appeared mid-run.
          const res = await prisma.superAdminAuditLog.updateMany({
            where: { id: row.id, [c]: null },
            data: { [c]: v },
          });
          if (res.count > 0) written[c]++;
          else skippedConcurrent[c]++;
        }
      } catch (err) {
        failures.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    aborted = true;
    throw err;
  } finally {
    const list = (items: string[]) => (items.length ? "\n  " + items.join("\n  ") : "");
    console.log("\n──── SuperAdminAuditLog snapshot-column backfill report ────");
    console.log(`${describeTarget(target)}${dryRun ? " (dry run)" : ""}`);
    if (aborted) console.log("!! RUN ABORTED by an unexpected error — counts below are PARTIAL. Re-run is safe (idempotent).");
    console.log(`Audit rows total: ${totalRows}; rows with at least one NULL target column: ${candidateRows}`);
    console.log(`\nPer column (rows scanned = NULL in that column):`);
    for (const c of COLUMNS) {
      console.log(
        `  ${c.padEnd(19)} scanned ${scanned[c]}  fillable ${fillable[c]}  ` +
          `${dryRun ? "(would write)" : `written ${written[c]}  skipped-mid-run ${skippedConcurrent[c]}`}  ` +
          `still-null ${stillNull[c]}`,
      );
    }
    console.log(`\nStill NULL, and why (re-verify these — NULL organizationId on a platform-scope row is correct):`);
    if (stillNullWhy.size === 0) console.log("  (none)");
    for (const [key, n] of [...stillNullWhy].sort()) console.log(`  ${n} × ${key}\n      e.g. ${(stillNullSamples.get(key) ?? []).join(", ")}`);
    console.log(`\n${dryRun ? "Sample of would-be changes (up to 10)" : "Sample of changes made (up to 10)"}:${list(sample)}`);
    console.log(`\nFailures (not written): ${failures.length}${list(failures)}`);
    if (failures.length || aborted) process.exitCode = 1;
    await prisma.$disconnect();
  }
}

// Run only when executed directly (not when imported for pure-function tests).
if (process.argv[1] && /backfill-audit-log-labels\.[cm]?[tj]s$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
