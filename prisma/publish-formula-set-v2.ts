/**
 * One-off production data step for hotfix 2026-10-02 (transom door: no L/I profile or white seal):
 * publish `cloisons_formula_set` v2 and (separately) make it the active set of the `cloisons` org.
 *
 * Source of truth for the v2 body is the DOCS repo file
 *   quotation-system-docs/design-docs/formulas/cloisons/cloisons_formula_set.v2.json
 * (the app repo deliberately carries no v2 copy: prisma/seed-formula-sets.ts only knows v1, and
 * `npx prisma db seed` must NOT be used here because it re-points cloisons at v1). The file path is
 * therefore an ARGUMENT (`--file=`), never hardcoded.
 *
 * Does exactly what the SuperAdmin editor does, and nothing else:
 *   - publish  = POST /api/v1/superadmin/formula-sets  -> validateFormulaSetBody() then FormulaSet.create
 *                (+ audit "formulaSet.create"). The body is stored as the file's parsed JSON, as the editor does.
 *   - activate = PATCH /api/v1/superadmin/orgs/[orgId] -> Organization.activeFormulaSetId = <set id>
 *                (+ audit "org.update"). Advisory structural-compat warnings are printed, never blocking
 *                (same as the editor, S25-13).
 * It does NOT re-pin existing projects (Project.formulaSetId is untouched; per-project re-pin is the
 * "Update configuration" wizard, H-6) and writes nothing outside FormulaSet, Organization.activeFormulaSetId
 * and SuperAdminAuditLog.
 *
 * Audit decision: the editor writes SuperAdminAuditLog rows, so this script does too — with
 * superAdminId = NULL (nullable since migration 20261002000001) and superAdminUsername =
 * "script:publish-formula-set-v2", so the audit-log page shows who/what made the change. Rows are
 * written in the SAME transaction as the mutation (stricter than the editor): no change without an audit row.
 *
 * Modes (mutually exclusive):
 *   (default)          publish v2.                       needs --file=<path>
 *   --activate         set cloisons' active set to v2.   needs --confirm-code-live; --file optional (if given,
 *                                                        the stored v2 body must equal it)
 *   --rollback         set cloisons' active set back to v1 (v2 row is never deleted). No ack needed.
 *
 * Safety (mirrors prisma/backfill-formula-set-pins.ts):
 *   - DRY RUN IS THE DEFAULT; rows are written only with `--write` (`--dry-run` / npm's dry-run config win).
 *     npm swallows unknown flags placed before `--`, so every flag must come AFTER `--`.
 *   - Fail-closed destination guard (prisma/db-target-guard.ts): dev endpoint by default; production only
 *     with EXPECT_ENDPOINT=ep-little-paper-aipm0o0i set in the operator's shell.
 *   - Immutable (name, version): an existing v2 with an identical body is a no-op; with a DIFFERENT body
 *     the script aborts non-zero. An existing row is never mutated or deleted.
 *   - --activate cannot verify that the new code (which exposes `partition.doorWidthMm`) is live; the
 *     operator must acknowledge it with --confirm-code-live (runbook ordering step).
 *   - Non-zero exit on any failure.
 *
 * Usage (from quotation-system/; see development-cycles/stage-27/hotfix-2026-10-02-transom-door-profile/prod-runbook.md):
 *   npm run publish:formula-set-v2 -- --file=<path-to-v2.json>                      # dry run: validate + diff
 *   npm run publish:formula-set-v2 -- --file=<path-to-v2.json> --write              # publish v2
 *   npm run publish:formula-set-v2 -- --activate --confirm-code-live                # dry run
 *   npm run publish:formula-set-v2 -- --activate --confirm-code-live --write        # activate v2
 *   npm run publish:formula-set-v2 -- --rollback --write                            # re-activate v1
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import type { Prisma } from "../app/generated/prisma/client";
import { describeTarget, enforceDbTarget } from "./db-target-guard";
import { validateFormulaSetBody } from "../lib/formula-set/validate";
import { deepEqual, diffFormulaSetBodies } from "../lib/formula-set/diff";
import { checkStructuralCompatibility } from "../lib/formula-compat";
import type { FormulaSetBody } from "../lib/summary/types";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

const SET_NAME = "cloisons_formula_set";
const ORG_SLUG = "cloisons";
const TARGET_VERSION = 2;
const ROLLBACK_VERSION = 1;
const AUDIT_ACTOR = "script:publish-formula-set-v2";

/** Value of `--name=value`, `null` if the flag is absent, "" if present with no value. */
export function flagValue(argv: string[], name: string): string | null {
  const arg = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!arg) return null;
  return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1).trim() : "";
}

function fail(msg: string): never {
  console.error(`ABORT: ${msg}`);
  process.exit(1);
}

async function main() {
  const argv = process.argv;
  const url = process.env.DATABASE_URL ?? "";
  const target = enforceDbTarget();

  const dryRun =
    !argv.includes("--write") || argv.includes("--dry-run") || process.env.npm_config_dry_run === "true";
  const activate = argv.includes("--activate");
  const rollback = argv.includes("--rollback");
  const confirmCodeLive = argv.includes("--confirm-code-live");
  const fileFlag = flagValue(argv, "file");

  // npm swallows flags that come before `--` into npm_config_*; fail instead of silently ignoring them.
  for (const [env, flag] of [
    ["npm_config_file", "--file=<path>"],
    ["npm_config_activate", "--activate"],
    ["npm_config_rollback", "--rollback"],
    ["npm_config_confirm_code_live", "--confirm-code-live"],
  ] as const) {
    const v = process.env[env];
    if (v && v !== "false") {
      fail(`npm swallowed ${flag} (it must come after \`--\`). Use: npm run publish:formula-set-v2 -- <flags>`);
    }
  }

  if (activate && rollback) fail("--activate and --rollback are mutually exclusive.");
  if (fileFlag !== null && fileFlag === "") fail("--file requires a path (--file=<path-to-v2.json>).");
  if (activate && !rollback && !confirmCodeLive) {
    fail(
      "--activate requires --confirm-code-live. Activating v2 before the code that exposes `partition.doorWidthMm` " +
        "is live makes every recompute see an undefined variable. Confirm the deployed build (route list + READY), " +
        "then re-run with --confirm-code-live.",
    );
  }
  const publishMode = !activate && !rollback;
  if (publishMode && fileFlag === null) fail("publish mode requires --file=<path-to-v2.json>.");

  // ── Load + validate the v2 doc (before touching the DB) ─────────────────────────────────────────
  let doc: Record<string, unknown> | null = null;
  if (fileFlag) {
    const abs = path.resolve(fileFlag);
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch (err) {
      fail(`cannot read ${abs}: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      doc = JSON.parse(text);
    } catch (err) {
      fail(`${abs} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    const v = validateFormulaSetBody(doc);
    if (!v.ok) {
      console.error(`Validation failed for ${abs}:`);
      for (const e of v.errors) console.error(`  - ${e}`);
      fail("the v2 body does not pass validateFormulaSetBody() — nothing was read or written.");
    }
    console.log(`Loaded + validated ${abs} (validateFormulaSetBody: ok).`);
  }

  // Loaded only after the guards, so a refused run never constructs a client.
  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  console.log(describeTarget(target));
  console.log(dryRun ? "DRY RUN — nothing will be written. (Pass `-- --write` to write.)" : "REAL RUN (--write).");
  const mode = rollback ? "ROLLBACK (activate v1)" : activate ? "ACTIVATE v2" : "PUBLISH v2";
  console.log(`Mode: ${mode}`);

  try {
    const org = await prisma.organization.findUnique({
      where: { slug: ORG_SLUG },
      select: {
        id: true,
        slug: true,
        activeFormulaSetId: true,
        activeFormulaSet: { select: { id: true, name: true, version: true, body: true } },
      },
    });
    if (!org) fail(`organization "${ORG_SLUG}" not found.`);
    const active = org.activeFormulaSet;
    console.log(
      `${ORG_SLUG} active set: ${active ? `${active.name} v${active.version} (${active.id})` : "NONE"}`,
    );

    const rows = await prisma.formulaSet.findMany({
      where: { name: SET_NAME },
      select: { id: true, version: true, body: true },
      orderBy: { version: "asc" },
    });
    console.log(`Existing ${SET_NAME} versions: ${rows.length ? rows.map((r) => `v${r.version}`).join(", ") : "none"}`);
    const v1 = rows.find((r) => r.version === ROLLBACK_VERSION);
    const v2 = rows.find((r) => r.version === TARGET_VERSION);

    if (publishMode) {
      if (!v1) fail(`${SET_NAME} v${ROLLBACK_VERSION} does not exist — expected the seeded v1 to be present.`);
      if (!doc) fail("internal: no doc loaded.");
      const compareTo = active ?? v1;
      if (active && active.name !== SET_NAME) {
        fail(`${ORG_SLUG}'s active set is "${active.name}", not ${SET_NAME} — unexpected, refusing.`);
      }

      // Structural diff against the currently ACTIVE body — for a human to eyeball before --write.
      const diff = diffFormulaSetBodies(JSON.stringify(compareTo.body), JSON.stringify(doc));
      console.log(`\n── Diff: ${SET_NAME} v${compareTo.version} (active body) -> file ──`);
      if (!diff.ok) fail(`diff failed (${diff.side}): ${diff.message}`);
      if (diff.identical) console.log("  (identical to the active body)");
      for (const f of diff.formulas) {
        console.log(`  ${f.kind.toUpperCase()}  ${f.id}`);
        for (const c of f.fields) {
          console.log(`      ${c.field}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
        }
      }
      for (const s of diff.slots) console.log(`  SLOT ${JSON.stringify(s)}`);
      for (const o of diff.other) console.log(`  OTHER ${JSON.stringify(o)}`);
      console.log(
        `  changed=${diff.counts.changed} added=${diff.counts.added} removed=${diff.counts.removed} unchanged=${diff.counts.unchanged}`,
      );
      console.log(`  changed formula ids: ${diff.formulas.map((f) => f.id).join(", ") || "(none)"}`);
      console.log("  EXPECTED for this hotfix: exactly profileL and profileI changed — anything else, STOP.");

      if (v2) {
        if (deepEqual(v2.body, doc)) {
          console.log(`\nv${TARGET_VERSION} already exists (${v2.id}) with an IDENTICAL body — nothing to do.`);
          return;
        }
        fail(
          `v${TARGET_VERSION} already exists (${v2.id}) with a DIFFERENT body. (name, version) is immutable — ` +
            "the script never mutates an existing row. Investigate; a corrected body needs v3 via the SuperAdmin editor.",
        );
      }
      const maxV = rows[rows.length - 1]?.version ?? 0;
      if (maxV >= TARGET_VERSION) fail(`unexpected: ${SET_NAME} has v${maxV} but no v${TARGET_VERSION}.`);

      if (dryRun) {
        console.log(`\nWould create ${SET_NAME} v${TARGET_VERSION} and write 1 audit row (formulaSet.create).`);
        return;
      }
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.formulaSet.create({
          data: { name: SET_NAME, version: TARGET_VERSION, body: doc as Prisma.InputJsonValue },
          select: { id: true },
        });
        await tx.superAdminAuditLog.create({
          data: {
            superAdminId: null,
            superAdminUsername: AUDIT_ACTOR,
            action: "formulaSet.create",
            targetType: "FormulaSet",
            targetId: row.id,
            organizationId: null,
            organizationSlug: null,
            targetLabel: `${SET_NAME} v${TARGET_VERSION}`,
            metadata: { name: SET_NAME, version: TARGET_VERSION, source: AUDIT_ACTOR },
          },
        });
        return row;
      });
      console.log(`\nCreated ${SET_NAME} v${TARGET_VERSION} (${created.id}). Not yet active — run --activate next.`);
      return;
    }

    // ── activate / rollback ────────────────────────────────────────────────────────────────────────
    const wantVersion = rollback ? ROLLBACK_VERSION : TARGET_VERSION;
    const want = rows.find((r) => r.version === wantVersion);
    if (!want) {
      fail(
        `${SET_NAME} v${wantVersion} does not exist` +
          (wantVersion === TARGET_VERSION ? " — publish it first (without --activate)." : "."),
      );
    }
    if (doc && !deepEqual(want.body, doc)) {
      fail(`stored v${wantVersion} body differs from --file — refusing to activate a set that is not the reviewed one.`);
    }
    if (org.activeFormulaSetId === want.id) {
      console.log(`\n${ORG_SLUG} is already on ${SET_NAME} v${wantVersion} — nothing to do.`);
      return;
    }

    // Advisory structural compat vs the org's component types (never blocking — same as the editor).
    const cts = await prisma.componentType.findMany({
      where: { organizationId: org.id },
      select: { code: true, active: true, fieldsSchema: true },
    });
    const compat = checkStructuralCompatibility(want.body as unknown as FormulaSetBody, {
      takenAt: new Date().toISOString(),
      componentTypes: cts.map((ct) => ({
        id: "",
        code: ct.code,
        name: "",
        active: ct.active,
        fieldsSchema: ct.fieldsSchema,
        fieldOptionsConfig: {},
      })),
    } as Parameters<typeof checkStructuralCompatibility>[1]);
    if (compat.ok) console.log("Structural compatibility with cloisons component types: ok.");
    else console.log(`WARNING (advisory) structural mismatch: ${JSON.stringify(compat)}`);

    const from = active ? `${active.name} v${active.version}` : "NONE";
    if (dryRun) {
      console.log(`\nWould set ${ORG_SLUG}.activeFormulaSetId: ${from} -> ${SET_NAME} v${wantVersion}, + 1 audit row (org.update).`);
      console.log("Existing projects keep their pin; DRAFT projects will show the out-of-date banner (re-pin via Update configuration).");
      return;
    }
    await prisma.$transaction(async (tx) => {
      // Conditional on the pin still being what we read, so a concurrent change is reported, not overwritten.
      const res = await tx.organization.updateMany({
        where: { id: org.id, activeFormulaSetId: org.activeFormulaSetId },
        data: { activeFormulaSetId: want.id },
      });
      if (res.count !== 1) throw new Error("activeFormulaSetId changed concurrently — re-run.");
      await tx.superAdminAuditLog.create({
        data: {
          superAdminId: null,
          superAdminUsername: AUDIT_ACTOR,
          action: "org.update",
          targetType: "Organization",
          targetId: org.id,
          organizationId: org.id,
          organizationSlug: org.slug,
          targetLabel: org.slug,
          metadata: {
            formulaSetId: want.id,
            previousFormulaSetId: org.activeFormulaSetId,
            formulaSet: `${SET_NAME} v${wantVersion}`,
            source: AUDIT_ACTOR,
          },
        },
      });
    });
    console.log(`\nSet ${ORG_SLUG}.activeFormulaSetId: ${from} -> ${SET_NAME} v${wantVersion}.`);
    console.log("Projects were NOT re-pinned. DRAFT projects now show the amber out-of-date banner; Recompute after re-pin.");
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when executed directly (not when imported for pure-function checks).
if (process.argv[1] && /publish-formula-set-v2\.[cm]?[tj]s$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
