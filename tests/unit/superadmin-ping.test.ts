import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// S32-9: the ping 500 goes through apiServerError(), so its body carries requestId.
// The prisma client is preseeded on globalThis (lib/prisma.ts reuses it) so no DB is touched.
beforeEach(() => {
  (globalThis as { prisma?: unknown }).prisma = {
    superAdminSession: {
      findUnique: async () => {
        throw new Error("db down");
      },
    },
  };
  mock.method(console, "log", () => {});
  mock.method(console, "error", () => {});
});
afterEach(() => {
  mock.restoreAll();
  delete (globalThis as { prisma?: unknown }).prisma;
});

test("ping: an unexpected guard failure returns a 500 with { error, requestId }", async () => {
  const { GET } = await import("@/app/api/v1/superadmin/ping/route");
  const res = await GET(
    new Request("http://localhost/api/v1/superadmin/ping", {
      headers: { cookie: "qs-sa-token=abc", "x-vercel-id": "iad1::ping-1" },
    }),
  );
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "Internal server error", requestId: "ping-1" });
});

test("ping: no cookie stays a 401 with the unchanged body", async () => {
  const { GET } = await import("@/app/api/v1/superadmin/ping/route");
  const res = await GET(new Request("http://localhost/api/v1/superadmin/ping"));
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Unauthorized" });
});
