/**
 * CLI backend for `tests/e2e/db-helpers.ts` — the direct-DB escape hatch Stage 22's E2E suite
 * (stage22-data-model.spec.ts) uses for the handful of states no API route can produce (see that
 * file's header). Runs under `tsx` as its own child process, invoked from the Playwright test.
 *
 * Why a child process at all, rather than a plain `await import(...)` inside the spec/helper:
 * Playwright's own TS loader transpiles specs (and everything they statically or dynamically
 * import) to CJS, which turns a dynamic `import("@/app/generated/prisma/client")` into a
 * `require()` of that (ESM-only, `prisma-client` generator) module and throws "Cannot use import
 * statement outside a module" the moment it actually runs — not caught by `--list`, which never
 * executes it. `prisma/migrate-design-v1-to-v2.ts` and `prisma/backfill-config-snapshots.ts` don't
 * hit this because they run under `tsx` directly (real ESM), never through Playwright's transform.
 * Shelling out to `tsx` here (same pattern devops used for the B4 DB-level check, see
 * `.engineering/stage-22/verify-b4.md` T6) puts this script under the exact same ESM-native runtime
 * those two already rely on, so the identical `await import(...)` line works unmodified.
 *
 * Protocol: `node <tsx-cli> e2e-db-helper-cli.ts <operation>`, JSON args on stdin, JSON result
 * (`{ ok: true, data }` or `{ ok: false, error }`) as the ONLY line printed to stdout. Exit code 0
 * on success, 1 on any failure (including the safety-guard refusal) — the caller distinguishes a
 * real DB/connection error from the guard's own refusal by matching on `error`, not the exit code.
 *
 * Safety: identical fail-closed destination allowlist to migrate-design-v1-to-v2.ts /
 * backfill-config-snapshots.ts — this suite only ever runs against the shared dev Neon branch.
 */
import dotenv from "dotenv";
import type { Prisma } from "../app/generated/prisma/client";
import { assertOrgInScope, assertSweepPrefix, assertDeletableInquiry, scopedOp, assertRowInScope, matchesSweepPrefix, normalizeSweepCode, addAllowedCodes, stripPrefixedCodes, SCOPED_ONLY_BASES, type OrgFieldConfig } from "../tests/regression/fixtures/db-scope";

// Same precedence as Next: real env > .env.local > .env (dotenv never overrides an already-set var).
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

const ALLOWED_ENDPOINT = "ep-solitary-unit-ais3pnxi";

function endpointOf(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    if (!host) return null;
    return host.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return null;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

async function main() {
  let op = process.argv[2];
  const url = process.env.DATABASE_URL ?? "";
  const endpoint = url ? endpointOf(url) : null;
  if (endpoint !== ALLOWED_ENDPOINT) {
    throw new Error(
      `regression/e2e DB test helper refuses to run: DATABASE_URL targets "${endpoint ?? "(unset/unparseable)"}", ` +
        `not the dev branch (${ALLOWED_ENDPOINT}). This suite must never touch any other database.`,
    );
  }

  const rawInput = await readStdin();
  const input = rawInput.trim() ? (JSON.parse(rawInput) as Record<string, unknown>) : {};

  // Loaded only after the guard — see file header.
  const { PrismaClient, Prisma } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    // Regression-suite scoped variants: refuse unless the target row is in the Test Org / an rgr- org.
    const scoped = scopedOp(op);
    // Ops with no legacy callers exist ONLY as their rgr: variant: the bare name would skip the scope check.
    if (!scoped && SCOPED_ONLY_BASES.has(op)) {
      throw new Error(`regression DB op refused: "${op}" is only reachable as "rgr:${op}" (scope-checked)`);
    }
    if (scoped) {
      const id = input[scoped.idKey];
      const where = { where: { id: typeof id === "string" ? id : "" }, select: { organization: { select: { slug: true } } } };
      const row = scoped.model === "project" ? await db.project.findUnique(where) : scoped.model === "selection" ? await db.selection.findUnique(where) : await db.partition.findUnique(where);
      assertRowInScope(op, id, row?.organization.slug);
      op = scoped.base;
    }
    switch (op) {
      case "seedV1Design": {
        const { partitionId, design } = input as { partitionId: string; design: Record<string, unknown> };
        await db.partition.update({
          where: { id: partitionId },
          data: { design: design as unknown as Prisma.InputJsonValue },
        });
        return null;
      }
      case "readPartitionRow": {
        const { partitionId } = input as { partitionId: string };
        return db.partition.findUniqueOrThrow({
          where: { id: partitionId },
          select: { design: true, widthMm: true, heightMm: true },
        });
      }
      case "nullOutConfigSnapshot": {
        const { projectId } = input as { projectId: string };
        await db.project.update({
          where: { id: projectId },
          data: { configSnapshot: Prisma.DbNull },
        });
        return null;
      }
      case "readConfigSnapshot": {
        const { projectId } = input as { projectId: string };
        const row = await db.project.findUniqueOrThrow({
          where: { id: projectId },
          select: { configSnapshot: true },
        });
        return row.configSnapshot;
      }
      case "deleteComponentType": {
        // Test-only teardown (Stage 22 B7 E6 cleanup), not app logic — there is no DELETE route
        // for ComponentType. Safe here because the only rows this helper ever creates are the
        // suite's own `E2E_<timestamp>`-coded freeze-test type, which the suite never selects
        // against (E6 only reads component-types lists / snapshots, never creates a Selection
        // referencing it) — a direct delete cannot leave a dangling FK.
        const { componentTypeId } = input as { componentTypeId: string };
        // Guard: only ever delete test-coded types; also remove the 1:1 ComponentTypeOrgConfig row
        // (created by any field-values PUT) first, otherwise the FK blocks the delete.
        const ct = await db.componentType.findUnique({ where: { id: componentTypeId }, select: { code: true } });
        if (!ct) return null;
        if (!ct.code.startsWith("E2E_")) {
          throw new Error(`deleteComponentType refused: ${ct.code} is not an E2E_-coded type`);
        }
        await db.componentTypeOrgConfig.deleteMany({ where: { componentTypeId } });
        await db.componentType.delete({ where: { id: componentTypeId } });
        return null;
      }
      // ── Stage 23 Batch 3 ops (tests/e2e/stage23-wiring.spec.ts) ─────────────────────────────────
      case "insertCalculation": {
        // A ProjectCalculation for the project, pinned to the project's own formulaSetId. Test-only:
        // Batch 5's submit/recompute is what writes these in the app.
        const { projectId } = input as { projectId: string };
        const proj = await db.project.findUniqueOrThrow({
          where: { id: projectId },
          select: { organizationId: true, formulaSetId: true },
        });
        if (!proj.formulaSetId) throw new Error("insertCalculation: project has no formulaSetId");
        await db.projectCalculation.create({
          data: {
            organizationId: proj.organizationId,
            projectId,
            formulaSetId: proj.formulaSetId,
            computedAt: new Date(),
            status: "OK",
            summary: { floors: [], kpis: { totalPartitionSqm: 0, sqmByGlassType: [], doorsByType: [] } },
          },
        });
        return null;
      }
      case "setDesignSubmittedAt": {
        const { projectId } = input as { projectId: string };
        await db.project.update({ where: { id: projectId }, data: { designSubmittedAt: new Date() } });
        return null;
      }
      case "readProjectState": {
        const { projectId } = input as { projectId: string };
        const p = await db.project.findUniqueOrThrow({
          where: { id: projectId },
          select: { formulaSetId: true, designSubmittedAt: true },
        });
        const calcCount = await db.projectCalculation.count({ where: { projectId } });
        return { formulaSetId: p.formulaSetId, designSubmittedAt: p.designSubmittedAt, calcCount };
      }
      case "readOrgActiveFormulaSet": {
        const { orgSlug } = input as { orgSlug: string };
        const org = await db.organization.findUniqueOrThrow({
          where: { slug: orgSlug },
          select: { activeFormulaSetId: true },
        });
        return org.activeFormulaSetId;
      }
      case "setOrgActiveFormulaSet": {
        const { orgSlug, formulaSetId } = input as { orgSlug: string; formulaSetId: string | null };
        await db.organization.update({ where: { slug: orgSlug }, data: { activeFormulaSetId: formulaSetId } });
        return null;
      }
      case "createTempFormulaSet": {
        // Throwaway "e2e-"-named set (never a real one) for the incompatible-config 409 check.
        const { name, body } = input as { name: string; body: Record<string, unknown> };
        if (!name.startsWith("e2e-")) throw new Error("createTempFormulaSet refused: name must start with e2e-");
        const row = await db.formulaSet.create({
          data: { name, version: 1, body: body as unknown as Prisma.InputJsonValue },
          select: { id: true },
        });
        return row.id;
      }
      case "deleteTempFormulaSet": {
        const { formulaSetId } = input as { formulaSetId: string };
        const fs = await db.formulaSet.findUnique({ where: { id: formulaSetId }, select: { name: true } });
        if (!fs) return null;
        if (!fs.name.startsWith("e2e-")) throw new Error(`deleteTempFormulaSet refused: ${fs.name}`);
        await db.formulaSet.delete({ where: { id: formulaSetId } });
        return null;
      }
      // ── Stage 23 Batch 7 (tests/e2e/stage23-summary.spec.ts) ────────────────────────────────────
      case "countProjectCalculations": {
        // Before/after proof that a SuperAdmin org hard-delete cascades ProjectCalculation rows
        // (D-20) — a successful delete already implies this (the FK would otherwise abort the
        // transaction), but this makes the cascade an explicit, independently-observed assertion.
        const { organizationId } = input as { organizationId: string };
        return db.projectCalculation.count({ where: { organizationId } });
      }
      case "setSelectionConfig": {
        // Writes a Selection's config verbatim, bypassing the API's config validation - only for states the
        // API now refuses by design (e.g. a key the type's schema lacks). Reached only as rgr:setSelectionConfig.
        const { selectionId, config } = input as { selectionId: string; config: Record<string, unknown> };
        await db.selection.update({ where: { id: selectionId }, data: { config: config as Prisma.InputJsonValue } });
        return null;
      }
      case "setProjectStatus": {
        // No API route can change Project.status this stage (Batch 5's own worklog note) — needed
        // only to exercise recompute's "non-DRAFT -> 409" gate (D-23). Test-only; callers must
        // revert to "DRAFT" afterward.
        const { projectId, status } = input as { projectId: string; status: string };
        await db.project.update({ where: { id: projectId }, data: { status } });
        return null;
      }
      // ── Stage 24 Batch 6 (tests/e2e/stage24-materials.spec.ts) ──────────────────────────────────
      case "setInventoryItemActive": {
        // Temporarily deactivate (or reactivate) an InventoryItem by code + org slug, for C2/I1
        // INACTIVE_ITEM tests. No API route exists for this — the /catalog routes do not expose
        // activate/deactivate. Callers MUST revert (active: true) in a finally block.
        const { code, orgSlug, active } = input as { code: string; orgSlug: string; active: boolean };
        const org = await db.organization.findUniqueOrThrow({ where: { slug: orgSlug }, select: { id: true } });
        await db.inventoryItem.updateMany({
          where: { organizationId: org.id, code },
          data: { active },
        });
        return null;
      }
      case "readCalculation": {
        // Read the full ProjectCalculation row for a project — used to verify what Submit Design
        // and Recompute actually wrote (including materialByRoom, which is omitted from all API
        // responses by lib/prisma.ts omit defaults). Returns null if no row exists.
        const { projectId } = input as { projectId: string };
        const row = await db.projectCalculation.findUnique({
          where: { projectId },
          select: { status: true, computedAt: true, materialList: true, materialByRoom: true },
        });
        return row;
      }
      // ── Hotfix 2026-10-02 (tests/e2e/superadmin-accounts.spec.ts) ───────────────────────────────
      case "readSuperAdminAuditRows": {
        // Audit rows written BY an actor username (snapshot column) — proves a deleted SuperAdmin's
        // history survives with a null link + the username snapshot (ON DELETE SET NULL).
        const { actorUsername } = input as { actorUsername: string };
        return db.superAdminAuditLog.findMany({
          where: { superAdminUsername: actorUsername },
          select: { action: true, superAdminId: true, superAdminUsername: true, targetType: true },
          orderBy: { createdAt: "asc" },
        });
      }
      case "purgeE2eSuperAdminAudit": {
        // Test-only teardown: the append-only audit log has no delete path in app code, so e2e's
        // throwaway "e2e-sa-*" accounts would leave rows behind forever. Removes ONLY rows authored
        // by an e2e-sa-* actor or whose metadata names an e2e-sa-* account (created/deleted/password).
        const prefix = "e2e-sa-";
        const res = await db.superAdminAuditLog.deleteMany({
          where: {
            OR: [
              { superAdminUsername: { startsWith: prefix } },
              // Audit-log page hotfix: entity-name snapshot — catches rows about e2e-sa-* users made in the Test Org.
              { targetLabel: { startsWith: prefix } },
              { metadata: { path: ["username"], string_starts_with: prefix } },
              { metadata: { path: ["deletedUsername"], string_starts_with: prefix } },
            ],
          },
        });
        return res.count;
      }
      // ── Regression suite (tests/regression) ─────────────────────────────────────────────────
      case "regressionSnapshot": {
        const { createHash } = await import("node:crypto");
        const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
        const orgs = await db.organization.findMany({
          select: { id: true, slug: true, name: true, isSuspended: true, activeFormulaSetId: true, updatedAt: true },
        });
        // Every table here has organizationId. `hasUpdatedAt` = model has an updatedAt column (Role does not).
        const tables = [
          { t: "user", hasUpdatedAt: true }, { t: "role", hasUpdatedAt: false }, { t: "externalCompany", hasUpdatedAt: true },
          { t: "project", hasUpdatedAt: true }, { t: "inquiry", hasUpdatedAt: true }, { t: "inventoryItem", hasUpdatedAt: true },
          { t: "selection", hasUpdatedAt: true }, { t: "floor", hasUpdatedAt: true }, { t: "room", hasUpdatedAt: true },
          { t: "partition", hasUpdatedAt: true }, { t: "projectCalculation", hasUpdatedAt: true }, { t: "componentType", hasUpdatedAt: true },
          { t: "componentTypeOrgConfig", hasUpdatedAt: true }, { t: "itemPrice", hasUpdatedAt: true },
          { t: "componentCategory", hasUpdatedAt: true },
        ] as const;
        const counts: Record<string, Record<string, number>> = {};
        const rowsByOrg: Record<string, Record<string, Array<{ id: string; updatedAt: Date }>>> = {};
        for (const { t, hasUpdatedAt } of tables) {
          if (hasUpdatedAt) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rows = (await (db as any)[t].findMany({ select: { id: true, organizationId: true, updatedAt: true }, orderBy: { id: "asc" } })) as Array<{ id: string; organizationId: string; updatedAt: Date }>;
            for (const r of rows) {
              const c = (counts[r.organizationId] ??= {});
              c[t] = (c[t] ?? 0) + 1;
              ((rowsByOrg[r.organizationId] ??= {})[t] ??= []).push({ id: r.id, updatedAt: r.updatedAt });
            }
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rows = await (db as any)[t].groupBy({ by: ["organizationId"], _count: { _all: true } });
            for (const r of rows as Array<{ organizationId: string; _count: { _all: number } }>) {
              (counts[r.organizationId] ??= {})[t] = r._count._all;
            }
          }
        }
        const cts = await db.componentType.findMany({ select: { id: true, organizationId: true, code: true, name: true, fieldsSchema: true, sortOrder: true }, orderBy: { id: "asc" } });
        const rps = await db.rolePermission.findMany({
          select: { roleId: true, permissionId: true, role: { select: { organizationId: true } } },
          orderBy: [{ roleId: "asc" }, { permissionId: "asc" }],
        });
        // Content (NOT updatedAt) of the org's shared configuration — the Test Org's teardown check (final review
        // I3): the suite edits and reverts these, and a revert restores content but always bumps updatedAt.
        const ctFull = await db.componentType.findMany({
          select: { id: true, organizationId: true, code: true, name: true, categoryId: true, fieldsSchema: true, active: true, sortOrder: true, createdAt: true },
          orderBy: { id: "asc" },
        });
        const cfgFull = await db.componentTypeOrgConfig.findMany({
          select: { id: true, organizationId: true, componentTypeId: true, fieldOptionsConfig: true, createdAt: true },
          orderBy: { id: "asc" },
        });
        const cats = await db.componentCategory.findMany({ select: { id: true, organizationId: true, name: true, createdAt: true }, orderBy: { id: "asc" } });
        const roles = await db.role.findMany({ select: { id: true, organizationId: true, name: true, description: true, isInternalRole: true }, orderBy: { id: "asc" } });
        const strip = <T extends { organizationId: string }>(rows: T[], orgId: string) =>
          rows.filter((r) => r.organizationId === orgId).map(({ organizationId: _o, ...r }) => r); // eslint-disable-line @typescript-eslint/no-unused-vars
        const out: Record<string, unknown> = {};
        for (const o of orgs) {
          const rowsHash: Record<string, string> = {};
          for (const [t, rows] of Object.entries(rowsByOrg[o.id] ?? {})) rowsHash[t] = sha(rows);
          // Role has no updatedAt: hash its editable content instead so a rename/description edit is caught (M2)
          const orgRoles = strip(roles, o.id);
          if (orgRoles.length) rowsHash.role = sha(orgRoles.map((r) => [r.id, r.name, r.description]));
          // Per-row version (updatedAt, or the role's content hash) so a delta can NAME the rows that changed (M3)
          const rows: Record<string, Record<string, string>> = {};
          for (const [t, list] of Object.entries(rowsByOrg[o.id] ?? {})) rows[t] = Object.fromEntries(list.map((r) => [r.id, new Date(r.updatedAt).toISOString()]));
          if (orgRoles.length) rows.role = Object.fromEntries(orgRoles.map((r) => [r.id, sha([r.name, r.description])]));
          const rolePermissionsHash = sha(rps.filter((r) => r.role.organizationId === o.id).map((r) => [r.roleId, r.permissionId]));
          out[o.slug] = {
            id: o.id,
            counts: counts[o.id] ?? {},
            componentTypesHash: sha(cts.filter((c) => c.organizationId === o.id)),
            rolePermissionsHash,
            rowsHash,
            rows,
            orgRowHash: sha([o.name, o.slug, o.isSuspended, o.activeFormulaSetId, o.updatedAt]),
            isSuspended: o.isSuspended,
            activeFormulaSetId: o.activeFormulaSetId,
            sharedConfig: {
              componentTypes: sha(strip(ctFull, o.id)),
              componentTypeOrgConfig: sha(strip(cfgFull, o.id)),
              componentCategories: sha(strip(cats, o.id)),
              roles: sha(orgRoles),
              rolePermissions: rolePermissionsHash,
              org: sha([o.name, o.slug, o.isSuspended, o.activeFormulaSetId]),
            },
          };
        }
        const fsets = await db.formulaSet.findMany({ select: { id: true, name: true, version: true, body: true }, orderBy: { id: "asc" } });
        const admins = await db.superAdmin.findMany({ select: { username: true }, orderBy: { username: "asc" } });
        const perms = await db.permission.findMany({ select: { code: true }, orderBy: { code: "asc" } });
        return {
          takenAt: new Date().toISOString(),
          orgs: out,
          globals: {
            formulaSetsHash: sha(fsets.filter((f) => !f.name.startsWith("rgr-") && !f.name.startsWith("e2e-"))),
            // the suite's own throwaway admins are excluded so create/delete cycles don't show up as drift
            superAdmins: admins.map((a) => a.username).filter((u) => !u.startsWith("rgr-") && !u.startsWith("e2e-sa-")),
            permissions: perms.map((p) => p.code),
          },
        };
      }
      case "regressionSweep": {
        // Rows in the Test Org (or an rgr- org) whose name starts with the prefix — orphan recovery and the post-run sweep.
        const { orgSlug, prefix } = input as { orgSlug: string; prefix: string };
        assertOrgInScope(orgSlug);
        assertSweepPrefix(prefix);
        const org = await db.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
        if (!org) return [];
        const [projects, inquiries, companies, items, users, roles] = await Promise.all([
          db.project.findMany({ where: { organizationId: org.id, name: { startsWith: prefix } }, select: { id: true, name: true } }),
          db.inquiry.findMany({ where: { organizationId: org.id, name: { startsWith: prefix } }, select: { id: true, name: true } }),
          db.externalCompany.findMany({ where: { organizationId: org.id, name: { startsWith: prefix } }, select: { id: true, name: true } }),
          // case-/padding-tolerant (see matchesSweepPrefix): candidates by an insensitive `contains`, then anchored in JS
          db.inventoryItem
            .findMany({ where: { organizationId: org.id, code: { contains: prefix, mode: "insensitive" } }, select: { id: true, code: true } })
            .then((rows) => rows.filter((r) => matchesSweepPrefix(r.code, prefix))),
          db.user.findMany({ where: { organizationId: org.id, username: { startsWith: prefix } }, select: { id: true, username: true } }),
          db.role.findMany({ where: { organizationId: org.id, name: { startsWith: prefix } }, select: { id: true, name: true } }),
        ]);
        return [
          ...projects.map((r) => ({ kind: "project", id: r.id, label: r.name })),
          ...inquiries.map((r) => ({ kind: "inquiry", id: r.id, label: r.name })),
          ...companies.map((r) => ({ kind: "externalCompany", id: r.id, label: r.name })),
          ...items.map((r) => ({ kind: "inventoryItem", id: r.id, label: normalizeSweepCode(r.code) })),
          ...users.map((r) => ({ kind: "user", id: r.id, label: r.username })),
          ...roles.map((r) => ({ kind: "role", id: r.id, label: r.name })),
        ];
      }
      case "regressionAllowCodes": {
        // Adds the run's rgr- inventory codes to a Test-Org type's dependent dropdown lists (see db-scope.ts).
        const { orgSlug, typeCode, parent, codes } = input as { orgSlug: string; typeCode: string; parent: string; codes: Record<string, string> };
        assertOrgInScope(orgSlug);
        return await db.$transaction(async (tx) => {
          const org = await tx.organization.findUniqueOrThrow({ where: { slug: orgSlug }, select: { id: true } });
          const cfgRow = await tx.componentTypeOrgConfig.findFirstOrThrow({
            where: { organizationId: org.id, componentType: { code: typeCode } },
            select: { id: true, fieldOptionsConfig: true },
          });
          const next = addAllowedCodes(cfgRow.fieldOptionsConfig as OrgFieldConfig, parent, codes);
          await tx.componentTypeOrgConfig.update({ where: { id: cfgRow.id }, data: { fieldOptionsConfig: next as Prisma.InputJsonValue } });
          return null;
        });
      }
      case "regressionStripCodes": {
        // Removes every option/valueMap value starting with `prefix` from the in-scope org's type configs.
        const { orgSlug, prefix } = input as { orgSlug: string; prefix: string };
        assertOrgInScope(orgSlug);
        assertSweepPrefix(prefix);
        const org = await db.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
        if (!org) return 0;
        let removed = 0;
        for (const row of await db.componentTypeOrgConfig.findMany({ where: { organizationId: org.id }, select: { id: true, fieldOptionsConfig: true } })) {
          const res = stripPrefixedCodes(row.fieldOptionsConfig as OrgFieldConfig, prefix);
          if (res.removed === 0) continue;
          await db.componentTypeOrgConfig.update({ where: { id: row.id }, data: { fieldOptionsConfig: res.cfg as Prisma.InputJsonValue } });
          removed += res.removed;
        }
        return removed;
      }
      case "regressionDelete": {
        // Inquiries have no DELETE route. Refuses anything that is not an rgr- inquiry in an in-scope org.
        // Returns true if deleted, false if no such inquiry in that org.
        const { orgSlug, kind, id } = input as { orgSlug: string; kind: string; id: string };
        assertOrgInScope(orgSlug);
        if (kind !== "inquiry") throw new Error(`regressionDelete: unsupported kind ${kind}`);
        const org = await db.organization.findUniqueOrThrow({ where: { slug: orgSlug }, select: { id: true } });
        const row = await db.inquiry.findFirst({ where: { id, organizationId: org.id }, select: { name: true } });
        if (!assertDeletableInquiry(row)) return false;
        await db.inquiry.delete({ where: { id } });
        return true;
      }
      default:
        throw new Error(`Unknown operation: ${op}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main()
  .then((data) => {
    process.stdout.write(JSON.stringify({ ok: true, data }));
    process.exit(0);
  })
  .catch((err: unknown) => {
    process.stdout.write(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  });
