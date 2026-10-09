import fs from "node:fs";
import path from "node:path";
import { RUN_DIR } from "../env";
import type { SaClient } from "./clients";

/**
 * The Test Org's `Organization.userLimit` (Stage 29, S29-7) — a setting the suite must change and then put back
 * EXACTLY (CLAUDE.md rule 10). Setup raises it so the run's role users and the specs' extra users fit; teardown
 * restores the original. The original is written to a file BEFORE the raise, so:
 *   - a crashed run (no teardown) cannot lose it: the next setup finds the file and keeps the ORIGINAL it holds,
 *     rather than mistaking the raised value for the original;
 *   - the file is deleted only after the restore was read back.
 * Nothing here depends on the migration's default or backfill: it works whatever the limit currently is.
 */
export const TEST_ORG_LIMIT_FILE = path.join(RUN_DIR, "test-org-user-limit.json");

/** How many users beyond the ones already in the Test Org the suite may need (role users + spec users). */
export const TEST_ORG_LIMIT_HEADROOM = 50;
/** Org B is created with this explicit limit (never the default 3): its specs add many users. */
export const ORG_B_USER_LIMIT = 25;

interface Pending {
  orgId: string;
  original: number;
}

/** Pure: the limit the suite needs in the Test Org — never lower than what is already set. */
export function neededTestOrgLimit(current: number, userCount: number): number {
  return Math.max(current, userCount + TEST_ORG_LIMIT_HEADROOM);
}

/** Pure: the original to restore — the file's value when a crashed run left one for the same org, else `current`. */
export function originalToRecord(current: number, pending: Pending | null, orgId: string): number {
  return pending && pending.orgId === orgId ? pending.original : current;
}

function readPending(): Pending | null {
  try {
    return JSON.parse(fs.readFileSync(TEST_ORG_LIMIT_FILE, "utf-8")) as Pending;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readOrg(sa: SaClient, orgId: string): Promise<{ userLimit: number; userCount: number }> {
  const r = await sa.get("/api/v1/superadmin/orgs");
  if (r.status() !== 200) throw new Error(`list orgs → HTTP ${r.status()}`);
  const org = ((await r.json()) as { orgs: { id: string; userLimit: number; userCount: number }[] }).orgs.find((o) => o.id === orgId);
  if (!org) throw new Error(`Test Org ${orgId} is not in the org list`);
  return org;
}

async function setLimit(sa: SaClient, orgId: string, userLimit: number): Promise<void> {
  const w = await sa.patch(`/api/v1/superadmin/orgs/${orgId}`, { data: { userLimit } });
  if (w.status() !== 200) throw new Error(`PATCH Test Org userLimit=${userLimit} → HTTP ${w.status()} ${await w.text()}`);
  const now = await readOrg(sa, orgId);
  if (now.userLimit !== userLimit) throw new Error(`Test Org userLimit is ${now.userLimit} after setting ${userLimit}`);
}

/** Setup: record the original (crash-safe), then raise the limit. Returns the original. */
export async function raiseTestOrgLimit(sa: SaClient, orgId: string): Promise<number> {
  const org = await readOrg(sa, orgId);
  const original = originalToRecord(org.userLimit, readPending(), orgId);
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(TEST_ORG_LIMIT_FILE, JSON.stringify({ orgId, original } satisfies Pending));
  const needed = neededTestOrgLimit(org.userLimit, org.userCount);
  if (needed !== org.userLimit) await setLimit(sa, orgId, needed);
  return original;
}

/**
 * Teardown: put the original back and read it back. Resolves to null on success, else the failure text
 * (reported as a revert failure — the pending file is KEPT so the next run still knows the original).
 */
export async function restoreTestOrgLimit(sa: SaClient, orgId: string): Promise<string | null> {
  const pending = readPending();
  if (!pending) return null; // setup never got as far as recording one
  try {
    if (pending.orgId !== orgId) throw new Error(`recorded for org ${pending.orgId}, not ${orgId}`);
    const now = await readOrg(sa, orgId);
    if (now.userLimit !== pending.original) await setLimit(sa, orgId, pending.original);
    fs.rmSync(TEST_ORG_LIMIT_FILE, { force: true });
    return null;
  } catch (err) {
    return `Test Org userLimit was NOT restored to ${pending.original}: ${err instanceof Error ? err.message : String(err)}`;
  }
}
