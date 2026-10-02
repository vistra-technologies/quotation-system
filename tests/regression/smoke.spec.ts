import { test, expect } from "@playwright/test";
import { covers } from "./fixtures/covers";

covers("GET /api/health");

test("health: the target is up and its database is connected", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(((await res.json()) as { database?: string }).database).toBe("connected");
});
