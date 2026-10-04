import type { Ledger, LedgerEntry } from "./ledger";
import type { SaClient } from "./clients";
import { OrgSessions } from "./org-delete";
import type { RunState } from "./run-state";
import { TEST_ORG } from "../env";
import { regressionDeleteInquiry } from "../../e2e/db-helpers";
import {
  drainOrder,
  generateRunPassword,
  isDeletableFormulaSetName,
  isDeletableOrgSlug,
  isDeletableSuperAdminUsername,
  isRunAdminUsername,
  reportOnlyNote,
} from "./cleanup-rules";

const inScope = (slug: string | null) => slug !== null && (slug === TEST_ORG || slug.startsWith("rgr-"));

export type OrgRow = { id: string; slug: string; activeFormulaSetId: string | null };

/** The single place that knows how to delete each ledger kind. Already-gone = success; anything else throws. */
export class Cleaner {
  private orgIds: Map<string, string> | null = null;
  readonly sessions: OrgSessions;

  constructor(
    private readonly sa: SaClient,
    opts: { baseURL: string; bypass?: string; adminPass?: string; run: RunState | null },
  ) {
    this.sessions = new OrgSessions({ ...opts, allowance: sa.allowance, resetPassword: (slug, id) => this.resetPassword(slug, id) });
  }

  /** Fresh (uncached) SuperAdmin org list. */
  async listOrgs(): Promise<OrgRow[]> {
    const r = await this.sa.get("/api/v1/superadmin/orgs");
    if (r.status() !== 200) throw new Error(`cleanup: list orgs → HTTP ${r.status()}`);
    return ((await r.json()) as { orgs: OrgRow[] }).orgs;
  }

  private async orgIdOf(slug: string): Promise<string | undefined> {
    this.orgIds ??= new Map((await this.listOrgs()).map((o) => [o.slug, o.id]));
    return this.orgIds.get(slug);
  }

  /** Orphan recovery: a crashed run's password is unknown — give its rgr- admin a fresh one via the SA route. */
  private async resetPassword(orgSlug: string, userId: string): Promise<string> {
    if (!inScope(orgSlug)) throw new Error(`password reset refused: org "${orgSlug}" is out of scope`);
    const orgId = await this.orgIdOf(orgSlug);
    if (!orgId) throw new Error(`password reset: org "${orgSlug}" not found`);
    this.sa.allowance.ids.add(orgId);
    const newPassword = generateRunPassword();
    const r = await this.sa.patch(`/api/v1/superadmin/orgs/${orgId}/users/${userId}`, { data: { newPassword } });
    if (r.status() !== 200) throw new Error(`password reset → HTTP ${r.status()}`);
    return newPassword;
  }

  private async deleteOrg(e: LedgerEntry): Promise<void> {
    const present = async () => (await this.listOrgs()).find((o) => o.id === e.id);
    const org = await present();
    if (!org) return; // already gone
    // R17: never trust the ledger label — the LIVE slug must be a suite org before the id is allowed.
    if (!isDeletableOrgSlug(org.slug)) {
      throw new Error(`cleanup REFUSED: org ${e.id} is "${org.slug}" (ledger said "${e.label}") — not an rgr- org, will not delete`);
    }
    this.sa.allowance.ids.add(e.id);
    const s = await this.sa.post(`/api/v1/superadmin/orgs/${e.id}/suspend`, { data: { suspend: true } });
    if (s.status() === 404) {
      if (await present()) throw new Error(`cleanup: suspend org ${org.slug} → 404 but the org is still listed`);
      return;
    }
    if (s.status() !== 200) throw new Error(`cleanup: suspend org ${org.slug} → HTTP ${s.status()}`);
    const r = await this.sa.delete(`/api/v1/superadmin/orgs/${e.id}`);
    if (r.status() === 404 && !(await present())) return;
    if (r.status() !== 200) throw new Error(`cleanup: delete org ${org.slug} → HTTP ${r.status()} ${await r.text()}`);
  }

  private async deleteSuperAdmin(e: LedgerEntry): Promise<void> {
    const admin = (await this.listSuperAdmins()).find((a) => a.id === e.id);
    if (!admin) return; // already gone
    if (!isDeletableSuperAdminUsername(admin.username)) {
      throw new Error(`cleanup REFUSED: SuperAdmin ${e.id} is "${admin.username}" — not an rgr-/e2e-sa- account, will not delete`);
    }
    this.sa.allowance.ids.add(e.id);
    const r = await this.sa.delete(`/api/v1/superadmin/admins/${e.id}`);
    if (r.status() !== 200 && r.status() !== 404) throw new Error(`cleanup: delete SuperAdmin ${admin.username} → HTTP ${r.status()}`);
  }

  /** Every SuperAdmin (no hashes). */
  async listSuperAdmins(): Promise<Array<{ id: string; username: string }>> {
    const r = await this.sa.get("/api/v1/superadmin/admins");
    if (r.status() !== 200) throw new Error(`cleanup: list SuperAdmins → HTTP ${r.status()}`);
    return ((await r.json()) as { admins: { id: string; username: string }[] }).admins;
  }

  /** Every formula set (list shape: no body). */
  async listFormulaSets(): Promise<Array<{ id: string; name: string; version: number }>> {
    const r = await this.sa.get("/api/v1/superadmin/formula-sets");
    if (r.status() !== 200) throw new Error(`cleanup: list formula sets → HTTP ${r.status()}`);
    return ((await r.json()) as { formulaSets: { id: string; name: string; version: number }[] }).formulaSets;
  }

  /** Platform-level suite rows with the given prefix (orphan recovery: "rgr-"; teardown: this run's prefix). */
  async globalsWithPrefix(prefix: string): Promise<Array<{ kind: "superadmin" | "formulaSet"; id: string; label: string }>> {
    const admins = (await this.listSuperAdmins()).filter((a) => a.username.startsWith(prefix));
    const sets = (await this.listFormulaSets()).filter((f) => f.name.startsWith(prefix));
    return [
      ...admins.map((a) => ({ kind: "superadmin" as const, id: a.id, label: a.username })),
      ...sets.map((f) => ({ kind: "formulaSet" as const, id: f.id, label: f.name })),
    ];
  }

  private async deleteFormulaSet(e: LedgerEntry): Promise<void> {
    const g = await this.sa.get(`/api/v1/superadmin/formula-sets/${encodeURIComponent(e.id)}`);
    if (g.status() === 404) return; // already gone
    if (g.status() !== 200) throw new Error(`cleanup: read formula set ${e.label} → HTTP ${g.status()}`);
    const fs = ((await g.json()) as { formulaSet: { name: string; version: number } }).formulaSet;
    // never trust the ledger label — the LIVE name must be a suite set before the id is allowed
    if (!isDeletableFormulaSetName(fs.name)) {
      throw new Error(`cleanup REFUSED: formula set ${e.id} is "${fs.name}" (ledger said "${e.label}") — not an rgr- set, will not delete`);
    }
    this.sa.allowance.ids.add(e.id);
    const r = await this.sa.delete(`/api/v1/superadmin/formula-sets/${e.id}`);
    if (r.status() !== 200 && r.status() !== 404) {
      throw new Error(`cleanup: delete formula set ${fs.name} v${fs.version} → HTTP ${r.status()} ${await r.text()}`);
    }
  }

  async deleteEntry(e: LedgerEntry): Promise<void> {
    const ok = (s: number) => s === 200 || s === 204 || s === 404;
    switch (e.kind) {
      case "inquiry":
        await regressionDeleteInquiry(e.orgSlug!, e.id); // false = already gone
        return;
      case "org":
        return this.deleteOrg(e);
      case "superadmin":
        return this.deleteSuperAdmin(e);
      case "formulaSet":
        return this.deleteFormulaSet(e);
      case "user": {
        if (!inScope(e.orgSlug)) throw new Error(`cleanup: user ${e.label} is in out-of-scope org "${e.orgSlug}"`);
        const orgId = await this.orgIdOf(e.orgSlug!);
        if (!orgId) return; // org already gone → its users went with it
        this.sa.allowance.ids.add(orgId);
        const r = await this.sa.delete(`/api/v1/superadmin/orgs/${orgId}/users/${e.id}`);
        if (!ok(r.status())) throw new Error(`cleanup: delete user ${e.label} → HTTP ${r.status()}`);
        return;
      }
      case "project":
      case "inventoryItem":
      case "externalCompany": {
        if (!inScope(e.orgSlug)) throw new Error(`cleanup: ${e.kind} ${e.label} is in out-of-scope org "${e.orgSlug}"`);
        this.sa.allowance.slugs.add(e.orgSlug!);
        await this.sessions.orgDelete(e as LedgerEntry & { kind: typeof e.kind });
        return;
      }
      case "role":
        // I2: the app has no DELETE route for a role; recovery/teardown report swept roles instead of draining them
        throw new Error(`cleanup: ${reportOnlyNote(e)}`);
      default:
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
        this.sessions.adminCandidates.set(e.orgSlug, [...(this.sessions.adminCandidates.get(e.orgSlug) ?? []), { username: e.label, id: e.id }]);
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

  /** Drain ledger entries (all, or the given subset), removing each from the ledger the moment its row is gone. */
  drainLedger(ledger: Ledger, entries: LedgerEntry[] = ledger.inDeleteOrder()) {
    return this.drain(entries, (e) => ledger.remove(e.id));
  }

  async dispose(): Promise<void> {
    await this.sessions.dispose();
  }
}
