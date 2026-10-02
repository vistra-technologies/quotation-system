import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import type { Guarded } from "./clients";
import type { Ledger } from "./ledger";
import type { Role, RunState } from "./run-state";
import { RUN_PASSWORD_ENV } from "../env";
import { apiUrl } from "../../e2e/helpers";

export interface Factories {
  project(name?: string): Promise<{ id: string; name: string }>;
  inquiry(name?: string): Promise<{ id: string; name: string }>;
  externalCompany(name?: string): Promise<{ id: string; name: string }>;
  user(role: Role, username?: string): Promise<{ id: string; username: string }>;
  inventoryItem(over?: Record<string, unknown>): Promise<{ id: string; code: string }>;
  wall(label?: string): Promise<{ projectId: string; floorId: string; roomId: string; partitionId: string }>;
  selection(projectId: string, code: "GLASS" | "DOOR", config: Record<string, string>): Promise<{ id: string }>;
}

const ROLE_NAME: Record<Role, string> = {
  admin: "Admin",
  member: "Company Member",
  distributor: "Distributor",
  architect: "Architectural Firm",
};

/**
 * Factories create rows through the Test Org admin's GUARDED client and ledger each row the moment it
 * exists (before returning), so a later failing assertion still gets cleaned up at teardown. Every
 * name/label/username/code carries run.prefix (rgr-<runId>-) plus a per-factory-instance random tag
 * (workers share the run prefix, so a counter alone could collide across workers).
 *
 * Children (floors/rooms/partitions/selections/calculations) cascade with their project and are not
 * ledgered separately.
 */
export function makeFactories(deps: { admin: Guarded; run: RunState; ledger: Ledger }): Factories {
  const { admin, run, ledger } = deps;
  const slug = run.testOrg.slug;
  const U = (p: string) => apiUrl(slug, `/api/v1/orgs/${slug}${p}`);
  const tag = randomBytes(3).toString("hex");
  let n = 0;
  const nm = (what: string) => `${run.prefix}${what}-${tag}${++n}`;

  const project: Factories["project"] = async (name = nm("proj")) => {
    const r = await admin.post(U("/projects"), { data: { name, currency: "AED", projectLocation: "Dubai, UAE" } });
    expect(r.status(), await r.text()).toBe(201);
    const id = ((await r.json()) as { project: { id: string } }).project.id;
    ledger.add({ kind: "project", id, orgSlug: slug, label: name });
    return { id, name };
  };

  const externalCompany: Factories["externalCompany"] = async (name = nm("co")) => {
    const r = await admin.post(U("/external-companies"), {
      data: { name, type: "DISTRIBUTOR", country: "UAE", defaultCurrency: "AED" },
    });
    expect(r.status(), await r.text()).toBe(201);
    // POST returns only { success } — find the row by its unique run-prefixed name.
    const l = await admin.get(U("/external-companies"));
    expect(l.status()).toBe(200);
    const co = ((await l.json()) as { companies: { id: string; name: string }[] }).companies.find((c) => c.name === name);
    if (!co) throw new Error(`external company ${name} was created but is not listed - it is unledgered; the next run's sweep removes it`);
    ledger.add({ kind: "externalCompany", id: co.id, orgSlug: slug, label: name });
    return { id: co.id, name };
  };

  return {
    project,
    externalCompany,

    async inquiry(name = nm("inq")) {
      const r = await admin.post(U("/inquiries"), { data: { name, currency: "AED", projectLocation: "Dubai, UAE" } });
      expect(r.status(), await r.text()).toBe(201);
      const id = ((await r.json()) as { inquiry: { id: string } }).inquiry.id;
      ledger.add({ kind: "inquiry", id, orgSlug: slug, label: name });
      return { id, name };
    },

    async user(role, username = nm(`u-${role}`)) {
      const password = process.env[RUN_PASSWORD_ENV];
      if (!password) throw new Error(`${RUN_PASSWORD_ENV} is not set - factories must run under the regression global setup`);
      const rr = await admin.get(U("/roles"));
      expect(rr.status(), await rr.text()).toBe(200);
      const roles = ((await rr.json()) as { roles: { id: string; name: string }[] }).roles;
      const roleId = roles.find((x) => x.name === ROLE_NAME[role])?.id;
      if (!roleId) throw new Error(`Test Org has no role "${ROLE_NAME[role]}"`);
      const external = role === "distributor" || role === "architect" ? (await externalCompany()).id : null;
      const r = await admin.post(U("/users"), {
        data: { username, firstName: "RGR", lastName: "User", password, roleId, externalCompanyId: external },
      });
      expect(r.status(), await r.text()).toBe(201);
      // POST returns only { user: { username } } — look the id up in the org user list.
      const l = await admin.get(U("/users"));
      expect(l.status()).toBe(200);
      const u = ((await l.json()) as { users: { id: string; username: string }[] }).users.find((x) => x.username === username);
      if (!u) throw new Error(`user ${username} was created but is not listed - it is unledgered; the next run's sweep removes it`);
      ledger.add({ kind: "user", id: u.id, orgSlug: slug, label: username });
      return { id: u.id, username };
    },

    async inventoryItem(over = {}) {
      const code = String((over as { code?: unknown }).code ?? nm("inv"));
      const r = await admin.post(U("/inventory"), {
        data: { name: `${code} name`, measurementUnit: "pieces", active: true, ...over, code },
      });
      expect(r.status(), await r.text()).toBe(201);
      const id = ((await r.json()) as { item: { id: string } }).item.id;
      ledger.add({ kind: "inventoryItem", id, orgSlug: slug, label: code });
      return { id, code };
    },

    async wall(label = "Wall A") {
      const { id: projectId } = await project();
      const fl = await admin.post(U("/floors"), { data: { projectId, label: `${run.prefix}F` } });
      expect(fl.status(), await fl.text()).toBe(201);
      const floorId = ((await fl.json()) as { floor: { id: string } }).floor.id;
      const rm = await admin.post(U("/rooms"), { data: { floorId, label: `${run.prefix}R` } });
      expect(rm.status(), await rm.text()).toBe(201);
      const roomId = ((await rm.json()) as { room: { id: string } }).room.id;
      const sides = await admin.patch(U(`/rooms/${roomId}/sides`), {
        data: {
          sides: [
            { kind: "PARTITION", turnDegrees: 90, label: `${run.prefix}${label}`, heightMm: 2400, widthMm: 2000 },
            { kind: "PLAIN", turnDegrees: 90 },
            { kind: "PLAIN", turnDegrees: 90 },
            { kind: "PLAIN", turnDegrees: 90 },
          ],
        },
      });
      expect(sides.status(), await sides.text()).toBe(200);
      const partitionId = ((await sides.json()) as { room: { sides: { partitionId?: string }[] } }).room.sides[0].partitionId;
      if (!partitionId) throw new Error("wall: sides PATCH returned no partitionId on side 0");
      return { projectId, floorId, roomId, partitionId };
    },

    async selection(projectId, code, config) {
      const t = await admin.get(U("/component-types"));
      expect(t.status()).toBe(200);
      const typeId = ((await t.json()) as { componentTypes: { id: string; code: string }[] }).componentTypes.find((x) => x.code === code)?.id;
      if (!typeId) throw new Error(`Test Org has no ComponentType ${code}`);
      const r = await admin.post(U("/selections"), {
        data: { projectId, componentTypeId: typeId, label: `${run.prefix}${code}`, config, orderIndex: 0 },
      });
      expect(r.status(), await r.text()).toBe(201);
      return { id: ((await r.json()) as { selection: { id: string } }).selection.id };
    },
  };
}
