/**
 * Unit tests for lib/data/default-glass.ts (Stage 34 S34-7) with a fake client: malformed stored designs
 * must not throw (the first glass Selection create runs this over every partition of the project), and
 * the lookup is scoped by organizationId + projectId.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fillProjectNullGlass, findDefaultGlassSelectionId } from "../../lib/data/default-glass";

describe("fillProjectNullGlass", () => {
  test("a section without cells is skipped; the rest of the project is still filled", async () => {
    const updates: { id: string; design: unknown }[] = [];
    const tx = {
      partition: {
        findMany: async () => [
          { id: "p-bad", design: { schemaVersion: 2, sections: [{ id: "x", widthMm: 900 }] } },
          { id: "p-ok", design: { schemaVersion: 2, sections: [{ id: "s", widthMm: 900, cells: [{ id: "c", heightMm: 2400, selectionId: null }] }] } },
          { id: "p-v1", design: { panels: [] } },
        ],
        update: async (a: { where: { id: string }; data: { design: unknown } }) => {
          updates.push({ id: a.where.id, design: a.data.design });
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await fillProjectNullGlass(tx as any, "org1", "proj1", "G");
    assert.deepEqual(r, { partitions: 1, cells: 1 });
    assert.deepEqual(updates.map((u) => u.id), ["p-ok"]);
  });
});

describe("findDefaultGlassSelectionId", () => {
  test("filters by organizationId and projectId, GLASS only, lowest orderIndex then oldest", async () => {
    let seen: unknown;
    const client = {
      selection: {
        findFirst: async (a: unknown) => {
          seen = a;
          return { id: "G1" };
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal(await findDefaultGlassSelectionId(client as any, "org1", "proj1"), "G1");
    assert.deepEqual(seen, {
      where: { organizationId: "org1", projectId: "proj1", componentType: { code: "GLASS" } },
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
  });
});
