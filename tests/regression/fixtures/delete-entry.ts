import { DELETE_ORDER, type Ledger, type LedgerEntry } from "./ledger";
import type { SaClient } from "./clients";
import { OrgSessions, isRunAdminUsername } from "./org-delete";
import type { RunState } from "./run-state";
import { TEST_ORG } from "../env";
import { regressionDeleteInquiry } from "../../e2e/db-helpers";

const inScope = (slug: string | null) => slug !== null && (slug === TEST_ORG || slug.startsWith("rgr-"));

/**
 * Children before parents (ledger DELETE_ORDER), with one exception: the run-admin user (rgr-…-admin) is
 * deleted AFTER the org-API kinds (project / inventoryItem / externalCompany), because it is the
 * session those deletes run under (DELETE_ORDER puts user before externalCompany).
 */
export function drainOrder(entries: LedgerEntry[]): LedgerEntry[] {
  const rank = (e: LedgerEntry) => {
    if (e.kind === "user" && isRunAdminUsername(e.label)) return DELETE_ORDER.indexOf("externalCompany") + 0.5;
    return DELETE_ORDER.indexOf(e.kind);
  };
  return [...entries].sort((a, b) => rank(a) - rank(b));
}

/** The single place that knows how to delete each ledger kind. 404 / already-gone = success; anything else throws. */
export class Cleaner {
  private orgIds: Map<string, string> | null = null;
  readonly sessions: OrgSessions;

  constructor(
    private readonly sa: SaClient,
    opts: { baseURL: string; bypass?: string; adminPass?: string; run: RunState | null },
  ) {
    this.sessions = new OrgSessions({ ...opts, allowance: sa.allowance });
  }

  private async orgIdOf(slug: string): Promise<string | undefined> {
    if (!this.orgIds) {
      const r = await this.sa.get("/api/v1/superadmin/orgs");
      if (r.status() !== 200) throw new Error(`cleanup: list orgs → HTTP ${r.status()}`);
      const { orgs } = (await r.json()) as { orgs: { id: string; slug: string }[] };
      this.orgIds = new Map(orgs.map((o) => [o.slug, o.id]));
    }
    return this.orgIds.get(slug);
  }

  async deleteEntry(e: LedgerEntry): Promise<void> {
    const ok = (s: number) => s === 200 || s === 204 || s === 404;
    const allow = this.sa.allowance;
    switch (e.kind) {
      case "inquiry":
        await regressionDeleteInquiry(e.orgSlug!, e.id); // false = already gone
        return;
      case "org": {
        allow.ids.add(e.id); // a ledgered org is ours by construction
        const s = await this.sa.post(`/api/v1/superadmin/orgs/${e.id}/suspend`, { data: { suspend: true } });
        if (s.status() === 404) return;
        if (s.status() !== 200) throw new Error(`cleanup: suspend org ${e.label} → HTTP ${s.status()}`);
        const r = await this.sa.delete(`/api/v1/superadmin/orgs/${e.id}`);
        if (!ok(r.status())) throw new Error(`cleanup: delete org ${e.label} → HTTP ${r.status()} ${await r.text()}`);
        return;
      }
      case "superadmin": {
        allow.ids.add(e.id);
        const r = await this.sa.delete(`/api/v1/superadmin/admins/${e.id}`);
        if (!ok(r.status())) throw new Error(`cleanup: delete SuperAdmin ${e.label} → HTTP ${r.status()}`);
        return;
      }
      case "user": {
        if (!inScope(e.orgSlug)) throw new Error(`cleanup: user ${e.label} is in out-of-scope org "${e.orgSlug}"`);
        const orgId = await this.orgIdOf(e.orgSlug!);
        if (!orgId) return; // org already gone → its users went with it
        allow.ids.add(orgId);
        const r = await this.sa.delete(`/api/v1/superadmin/orgs/${orgId}/users/${e.id}`);
        if (!ok(r.status())) throw new Error(`cleanup: delete user ${e.label} → HTTP ${r.status()}`);
        return;
      }
      case "project":
      case "inventoryItem":
      case "externalCompany": {
        if (!inScope(e.orgSlug)) throw new Error(`cleanup: ${e.kind} ${e.label} is in out-of-scope org "${e.orgSlug}"`);
        allow.slugs.add(e.orgSlug!);
        await this.sessions.orgDelete(e as LedgerEntry & { kind: typeof e.kind });
        return;
      }
      case "role":
      case "componentType":
      case "formulaSet":
        throw new Error(`cleanup: no deleter wired for ${e.kind} (${e.label}) yet — add one before a test ledgers this kind`);
    }
  }

  /**
   * Delete `entries` in drain order. Each success is reported through `onDeleted` (the ledger drain
   * removes the entry there); failures are collected, never thrown, so one bad row can't strand the rest.
   */
  async drain(entries: LedgerEntry[], onDeleted?: (e: LedgerEntry) => void): Promise<{ deleted: string[]; errors: string[] }> {
    const ordered = drainOrder(entries);
    this.sessions.reset();
    for (const e of ordered) {
      if (e.kind === "user" && e.orgSlug && isRunAdminUsername(e.label)) {
        this.sessions.adminCandidates.set(e.orgSlug, [...(this.sessions.adminCandidates.get(e.orgSlug) ?? []), e.label]);
      }
    }
    const deleted: string[] = [];
    const errors: string[] = [];
    for (const e of ordered) {
      try {
        await this.deleteEntry(e);
        onDeleted?.(e);
        deleted.push(`${e.kind}:${e.label}`);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    return { deleted, errors };
  }

  /** Drain the persistent ledger (removing each entry the moment its row is gone). */
  drainLedger(ledger: Ledger) {
    return this.drain(ledger.inDeleteOrder(), (e) => ledger.remove(e.id));
  }

  async dispose(): Promise<void> {
    await this.sessions.dispose();
  }
}
