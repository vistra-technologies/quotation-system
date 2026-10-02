import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { requireEnv, TEST_ORG, RUN_DIR, LEDGER_FILE, RUN_PASSWORD_ENV } from "./env";
import { Ledger } from "./fixtures/ledger";
import { SaClient, Guarded, createAllowance } from "./fixtures/clients";
import { clearRunState, writeRunState, type Role, type RunState } from "./fixtures/run-state";
import { Cleaner } from "./fixtures/delete-entry";
import { recoverOrphans } from "./fixtures/recovery";
import { generateRunPassword, recoverMinAgeMs } from "./fixtures/cleanup-rules";
import { regressionSnapshot, regressionSweep } from "../e2e/db-helpers";
import { apiSignIn, apiUrl, getSeededFormulaSetId } from "../e2e/helpers";

const ROLE_NAME: Record<Role, string> = {
  admin: "Admin",
  member: "Company Member",
  distributor: "Distributor",
  architect: "Architectural Firm",
};

export default async function globalSetup() {
  const env = requireEnv();
  clearRunState(); // a stale run.json must never be mistaken for this run's state
  const runId = Date.now().toString(36);
  const prefix = `rgr-${runId}-`;
  const orgBSlug = `rgr-${runId}-b`;
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const storageDir = path.join(RUN_DIR, runId);
  fs.mkdirSync(storageDir, { recursive: true });
  // R18: per-run password, in memory only. Workers inherit process.env; nothing is written to disk.
  const password = generateRunPassword();
  process.env[RUN_PASSWORD_ENV] = password;

  const allowance = createAllowance([TEST_ORG]);
  const sa = await SaClient.login(env.baseURL, env.saUser, env.saPass, allowance, env.bypass);
  const ledger = new Ledger(LEDGER_FILE);
  const recoveryCleaner = new Cleaner(sa, { ...env, run: null });
  const listOrgs = () => recoveryCleaner.listOrgs();

  // 0. Orphan recovery FIRST: a crashed previous run must not leak into this one.
  let testOrg = (await listOrgs()).find((o) => o.slug === TEST_ORG);
  if (testOrg) allowance.ids.add(testOrg.id);
  const minAgeMs = recoverMinAgeMs();
  try {
    const rec = await recoverOrphans({
      cleaner: recoveryCleaner,
      ledger,
      sweep: regressionSweep,
      rgrOrgs: async () => (await listOrgs()).filter((o) => o.slug.startsWith("rgr-")),
      minAgeMs,
    });
    const n = rec.drained.length + rec.swept.length;
    console.log(
      n
        ? `[regression] recovered ${n} orphans (ledger: ${rec.drained.length}${rec.drained.length ? ` — ${rec.drained.join(", ")}` : ""}; sweep: ${rec.swept.length}${rec.swept.length ? ` — ${rec.swept.join(", ")} (UNLEDGERED — a registration bug)` : ""})`
        : "[regression] recovered 0 orphans",
    );
    if (rec.skipped.length) {
      console.log(`[regression] orphan recovery SKIPPED ${rec.skipped.length} row(s) younger than ${Math.round(minAgeMs / 60000)} min or of unknown age (not deleted):\n  ${rec.skipped.join("\n  ")}`);
    }
  } finally {
    await recoveryCleaner.dispose(); // closes its browser sessions; listOrgs() (SA-only) keeps working
  }

  // 1. Baseline snapshot BEFORE we touch anything (the final diff proves non-interference).
  const baseline = await regressionSnapshot();

  // 2. Test Org: must exist; create via SA if missing (needs TEST_ADMIN_PASSWORD — Ruling R1).
  const fsId = await getSeededFormulaSetId(sa.ctx, sa.token);
  if (!testOrg) {
    if (!env.adminPass) {
      throw new Error(`Test Org "${TEST_ORG}" does not exist and TEST_ADMIN_PASSWORD is unset — set it (the new org's admin password) to let setup create the Test Org.`);
    }
    const r = await sa.post("/api/v1/superadmin/orgs", { data: { name: "E2E Test Org", slug: TEST_ORG, adminPassword: env.adminPass, formulaSetId: fsId } });
    if (r.status() !== 201) throw new Error(`could not create Test Org: HTTP ${r.status()} ${await r.text()}`);
    testOrg = (await listOrgs()).find((o) => o.slug === TEST_ORG)!;
    allowance.ids.add(testOrg.id);
  }

  // 3. Prerequisites — the suite does NOT repair Test Org configuration; it fails loudly with the exact gap.
  const ctRes = await sa.get(`/api/v1/superadmin/component-types?orgId=${testOrg.id}`);
  if (ctRes.status() !== 200) throw new Error(`list Test Org component types → HTTP ${ctRes.status()}`);
  const types = ((await ctRes.json()) as { componentTypes: { code: string }[] }).componentTypes;
  const missing: string[] = [];
  for (const code of ["GLASS", "DOOR"]) {
    if (!types.some((t) => t.code === code)) missing.push(`ComponentType ${code}`);
  }
  if (!testOrg.activeFormulaSetId) missing.push("an active formula set (Organization.activeFormulaSetId is null)");
  if (missing.length) {
    throw new Error(`Test Org "${TEST_ORG}" prerequisites missing: ${missing.join("; ")}. Fix the Test Org — the suite will not guess.`);
  }

  // Everything created from here on is ledgered the moment it exists; a failure tears it down again.
  const created = new Cleaner(sa, { ...env, run: null });
  try {
    // 4. Throwaway org B for cross-tenant probes (deleted at teardown).
    const b = await sa.post("/api/v1/superadmin/orgs", { data: { name: `RGR ${runId} B`, slug: orgBSlug, adminPassword: password, formulaSetId: fsId } });
    if (b.status() !== 201) throw new Error(`could not create throwaway org B: HTTP ${b.status()} ${await b.text()}`);
    const orgB = ((await b.json()) as { org: { id: string; slug: string } }).org;
    ledger.add({ kind: "org", id: orgB.id, orgSlug: orgB.slug, label: orgB.slug });
    allowance.slugs.add(orgB.slug);
    allowance.ids.add(orgB.id);

    // 5. One user per role inside the Test Org (ledgered), then one sign-in per role → storageState.
    const rolesRes = await sa.get(`/api/v1/superadmin/roles?orgId=${testOrg.id}`);
    if (rolesRes.status() !== 200) throw new Error(`list Test Org roles → HTTP ${rolesRes.status()}`);
    const roles = ((await rolesRes.json()) as { roles: { id: string; name: string }[] }).roles;
    const roleId = (role: Role) => {
      const r = roles.find((x) => x.name === ROLE_NAME[role]);
      if (!r) throw new Error(`Test Org prerequisite missing: role "${ROLE_NAME[role]}"`);
      return r.id;
    };
    const usernames: Record<Role, string> = { admin: `${prefix}admin`, member: `${prefix}member`, distributor: `${prefix}dist`, architect: `${prefix}arch` };
    const users = {} as RunState["users"];
    const createUser = async (role: Role, externalCompanyId?: string) => {
      const u = await sa.post(`/api/v1/superadmin/orgs/${testOrg!.id}/users`, {
        data: { firstName: "RGR", lastName: role, username: usernames[role], roleId: roleId(role), password, ...(externalCompanyId ? { externalCompanyId } : {}) },
      });
      if (u.status() !== 201) throw new Error(`could not create ${role} user: HTTP ${u.status()} ${await u.text()}`);
      const id = ((await u.json()) as { user: { id: string } }).user.id;
      ledger.add({ kind: "user", id, orgSlug: TEST_ORG, label: usernames[role] });
      users[role] = { username: usernames[role], id };
    };
    await createUser("admin"); // first: its session creates the external company
    await createUser("member");

    const browser = await chromium.launch();
    try {
      const headers = env.bypass ? { "x-vercel-protection-bypass": env.bypass } : undefined;
      // One sign-in per identity; storageState files: admin, member, distributor, architect, orgB-admin.
      const signInAs = async (fileName: string, username: string, orgSlug: string) => {
        const ctx = await browser.newContext({ baseURL: env.baseURL, extraHTTPHeaders: headers });
        const page = await ctx.newPage();
        await apiSignIn(page, orgSlug, username, password);
        await ctx.storageState({ path: path.join(storageDir, `${fileName}.json`) });
        await ctx.close();
      };
      await signInAs("admin", usernames.admin, TEST_ORG);

      // External company for the distributor/architect users (U3: non-internal roles need one).
      const adminCtx = await browser.newContext({ baseURL: env.baseURL, extraHTTPHeaders: headers, storageState: path.join(storageDir, "admin.json") });
      try {
        const admin = new Guarded(adminCtx.request, allowance);
        const companyName = `${prefix}Co`;
        const coRes = await admin.post(apiUrl(TEST_ORG, `/api/v1/orgs/${TEST_ORG}/external-companies`), {
          data: { name: companyName, type: "DISTRIBUTOR", country: "UAE", defaultCurrency: "AED" },
        });
        if (coRes.status() !== 201) throw new Error(`could not create external company: HTTP ${coRes.status()} ${await coRes.text()}`);
        // POST returns only { success } — look the new row up by its unique run-prefixed name.
        const listRes = await admin.get(apiUrl(TEST_ORG, `/api/v1/orgs/${TEST_ORG}/external-companies`));
        if (listRes.status() !== 200) {
          throw new Error(`external company ${companyName} WAS CREATED but could not be located (list → HTTP ${listRes.status()}); it is not ledgered — the next run's sweep will delete it`);
        }
        const companies = ((await listRes.json()) as { companies: { id: string; name: string }[] }).companies;
        const company = companies.find((c) => c.name === companyName);
        if (!company) {
          throw new Error(`external company ${companyName} WAS CREATED but is not in the list; it is not ledgered — the next run's sweep will delete it`);
        }
        ledger.add({ kind: "externalCompany", id: company.id, orgSlug: TEST_ORG, label: company.name });

        await createUser("distributor", company.id);
        await createUser("architect", company.id);
      } finally {
        await adminCtx.close();
      }
      for (const role of ["member", "distributor", "architect"] as const) await signInAs(role, usernames[role], TEST_ORG);
      await signInAs("orgB-admin", "admin", orgB.slug); // org B's seeded admin (password = adminPassword above)
    } finally {
      await browser.close();
    }

    if (process.env.RGR_KILL_AFTER_SETUP) {
      // Test seam: simulate a crash after rows exist — the NEXT run's orphan recovery must clean them up.
      console.log(`[regression] RGR_KILL_AFTER_SETUP: exiting after setup, leaving ${ledger.all().filter((e) => e.label.startsWith(prefix)).length} ledgered rows behind`);
      process.exit(1);
    }
    writeRunState({
      runId, prefix,
      testOrg: { id: testOrg.id, slug: testOrg.slug },
      orgB: { id: orgB.id, slug: orgB.slug, adminUser: "admin" },
      formulaSetId: fsId, users, storageDir, baseline,
    });
    console.log(`[regression] run ${runId}: Test Org ${TEST_ORG}, org B ${orgB.slug}, ${Object.keys(users).length} role users, ${ledger.all().filter((e) => e.label.startsWith(prefix)).length} ledgered rows`);
  } catch (err) {
    // Setup failed half-way: tear down what was created now rather than waiting for the next run.
    const { errors } = await created.drainLedger(ledger, ledger.inDeleteOrder().filter((e) => e.label.startsWith(prefix)));
    await created.dispose();
    fs.rmSync(storageDir, { recursive: true, force: true }); // storage states hold session cookies
    if (errors.length) console.error(`[regression] setup rollback left rows behind (next run's orphan recovery retries):\n  ${errors.join("\n  ")}`);
    throw err;
  }
  await created.dispose();
  await sa.dispose();
}
