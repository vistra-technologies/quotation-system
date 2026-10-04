import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSameTarget } from "../regression/fixtures/target-identity";

const db = { cloisons: { id: "c1" }, "e2e-testorg": { id: "t1" } };

test("same {slug → id} on the API target and the dev DB → passes", () => {
  assert.doesNotThrow(() => assertSameTarget([{ slug: "cloisons", id: "c1" }, { slug: "e2e-testorg", id: "t1" }], db));
  // an rgr- org present on both sides with the same id is fine too
  assert.doesNotThrow(() =>
    assertSameTarget([{ slug: "e2e-testorg", id: "t1" }, { slug: "rgr-x-b", id: "b1" }], { ...db, "rgr-x-b": { id: "b1" } }),
  );
});

test("a production-like target (same slugs, different ids) is refused, naming the mismatch", () => {
  assert.throws(
    () => assertSameTarget([{ slug: "cloisons", id: "PROD-c" }, { slug: "e2e-testorg", id: "PROD-t" }], db),
    (e: Error) => /NOT proven to run on the dev DB/.test(e.message) && /e2e-testorg": API target id PROD-t ≠ dev DB id t1/.test(e.message) && /cloisons/.test(e.message),
  );
});

test("the Test Org on one side only is refused (setup would otherwise CREATE it on the wrong target)", () => {
  assert.throws(() => assertSameTarget([{ slug: "cloisons", id: "c1" }], db), /e2e-testorg" is in the dev DB/);
  assert.throws(() => assertSameTarget([{ slug: "cloisons", id: "c1" }, { slug: "e2e-testorg", id: "t1" }], { cloisons: { id: "c1" } }), /not in the dev DB/);
});

test("an rgr- org on one side only is refused (recovery would delete through the wrong target)", () => {
  assert.throws(
    () => assertSameTarget([{ slug: "cloisons", id: "c1" }, { slug: "e2e-testorg", id: "t1" }, { slug: "rgr-old-b", id: "z" }], db),
    /rgr-old-b" is listed by the API target/,
  );
});

test("no org in common proves nothing → refused", () => {
  assert.throws(() => assertSameTarget([{ slug: "other", id: "o" }], { cloisons: { id: "c1" } }), /no organization is present on both/);
});

test("M-b: a target where the Test Org exists on neither side is refused — pre-split orgs (cloisons) share ids with production", () => {
  const onlyCloisons = { cloisons: { id: "c1" } };
  assert.throws(() => assertSameTarget([{ slug: "cloisons", id: "c1" }], onlyCloisons), /Test Org "e2e-testorg" exists neither[\s\S]*RGR_CREATE_TEST_ORG=1/);
  // explicit create-the-Test-Org run: allowed to proceed to creation (setup re-checks with the Test Org required)
  assert.doesNotThrow(() => assertSameTarget([{ slug: "cloisons", id: "c1" }], onlyCloisons, { requireTestOrg: false }));
  // ...and the re-check after creation passes only when the created org is the dev DB's row
  assert.doesNotThrow(() => assertSameTarget([{ slug: "cloisons", id: "c1" }, { slug: "e2e-testorg", id: "t9" }], { ...onlyCloisons, "e2e-testorg": { id: "t9" } }, { requireTestOrg: true }));
  assert.throws(() => assertSameTarget([{ slug: "cloisons", id: "c1" }, { slug: "e2e-testorg", id: "t9" }], onlyCloisons, { requireTestOrg: true }), /listed by the API target.*not in the dev DB/);
});
