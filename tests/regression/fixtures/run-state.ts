import fs from "node:fs";
import path from "node:path";
import { RUN_FILE } from "../env";
import type { Snapshot } from "./snapshot";

export type Role = "admin" | "member" | "distributor" | "architect";
export interface RunState {
  runId: string;
  prefix: string;
  testOrg: { id: string; slug: string };
  orgB: { id: string; slug: string; adminUser: string };
  formulaSetId: string;
  users: Record<Role, { username: string; id: string }>;
  password: string;
  /** <RUN_DIR>/<runId>: {admin,member,distributor,architect,orgB-admin}.json storage states + cleanup.json */
  storageDir: string;
  baseline: Snapshot;
}

export function writeRunState(s: RunState): void {
  fs.mkdirSync(path.dirname(RUN_FILE), { recursive: true });
  fs.writeFileSync(RUN_FILE, JSON.stringify(s, null, 2));
}

export function readRunState(): RunState {
  return JSON.parse(fs.readFileSync(RUN_FILE, "utf-8")) as RunState;
}

/** null when no run state exists (setup never completed). */
export function tryReadRunState(): RunState | null {
  try {
    return readRunState();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Setup removes the previous run's state first so a crashed setup can never be mistaken for a live run. */
export function clearRunState(): void {
  fs.rmSync(RUN_FILE, { force: true });
}
