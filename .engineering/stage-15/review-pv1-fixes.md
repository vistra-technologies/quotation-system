# Review — PV1 fixes (sticky header + greeting name)

**Branch:** `feature/fix-sticky-header-and-greeting`
**Commits:** `1cab3a0`, `553a282`
**Diff:** `diff-pv1-fixes.patch` (480 lines)
**Reviewer:** reviewer · 2026-08-18

---

## Verdict: APPROVE-WITH-NITS

0 CRITICAL · 0 IMPORTANT · 1 MINOR

The production code in all three changed files is correct. One test comment overstates the
test's falsifiability — developer's call whether to update it.

---

## Findings

### MINOR — Test comment incorrectly claims a reverted seed would fail the test
**File:** `tests/e2e/stage15-b.spec.ts` · lines ~452–458 (the D1 test block comment)

**Concrete issue:**
The comment reads: *"Falsifiable: if the dashboard reads from a cached/derived source
(e.g. the old seed 'acme-glass admin' style) instead of the current User.name, the
greeting would not contain me.name ('Admin User') and the test fails."*

This is inaccurate about the seed-revert scenario. The test fetches `me.name` via `/me`
and asserts the greeting contains it. If the seed were reverted so `User.name` = `"acme-glass admin"`:
- `/me` returns `name: "acme-glass admin"`
- Dashboard renders `"Welcome, acme-glass admin"`
- `me.name` matches the greeting → **test PASSES silently**

What the test actually guards against is the dashboard implementation reading from a
different source than `/me` — e.g., if someone changed `dashboard/page.tsx` to render
`session.username` or a hardcoded value. That is a genuine regression guard and the test
is sound for that purpose. The comment just names the wrong failure scenario.

**Suggested fix:** Change the comment to: *"Falsifiable: if the dashboard reads from a
different source than `/me` (e.g. session.username, a cached token, or a hardcoded
value), the greeting would not match me.name and the test fails."*

**Impact:** The comment only affects readability, not test behaviour. The test itself runs
correctly and is a legitimate data-correctness invariant.

---

## Review focus confirmed clean

**1. Sticky header CSS correctness — SOUND**

Root cause analysis in `plan-pv1-fixes.md` is accurate. The old nested structure
(`overflow-y-auto` outer → `overflow-x-auto` inner div → table) made the inner div a
CSS scroll container; `position: sticky` on `<thead>` targeted that inner container,
which never overflowed vertically, so sticky had no effect.

New structure in both pages:
```
<div class="flex-1 min-h-0 overflow-auto px-4">   ← single scroll container
  <table class="w-full">
    <thead class="sticky top-0 z-10 bg-bg-card">  ← sticks to the container above
```

This is correct. Three conditions for sticky `<thead>` are all met:
- The scroll container (`overflow-auto`) has a bounded finite height — confirmed by the
  flex chain the prior reviewer verified: `h-screen → main flex-1 → layout h-full →
  page h-full flex-col → card flex-1 min-h-0 → inner flex-1 min-h-0 overflow-auto`.
- No intermediate `overflow: hidden/auto/scroll` wrapper between `<thead>` and the
  scroll container (the inner `overflow-x-auto` div was removed).
- The `<table>` itself has no overflow property (`w-full` is width only).

Horizontal scroll is preserved: `overflow-auto` handles both axes. The header scrolls
horizontally with the table, which is the correct behaviour for a wide table.

No automated test was added for sticky behaviour — wireframe rule (CLAUDE.md §5) is
respected. Manual verification is the correct instrument here.

**2. Seed fix correctness and blast radius — SAFE**

Confirmed via reading `prisma/seed.ts` lines 239–251 post-fix:

- The update path (`prisma.user.update`) specifies only `data: { name: expectedName }`.
  No other fields are touched on existing users.
- The update is conditional: `if (existing.name !== expectedName)` — a no-op re-run
  costs a `findUnique` and a string comparison, nothing more.
- `displayName` field is fully removed from all four `userSlots` entries (admin, member,
  distributor, architect) — no orphaned references.
- New-user create path uses `` `${slot.firstName} ${slot.lastName}` `` — consistent with
  `createUser` and `updateUserProfile` in `lib/data/users.ts`.

Blast radius on consumers of `User.name` (grepped across `app/**`):
- `dashboard/page.tsx:73` — the greeting; this is the fix target.
- `layout.tsx:82` — avatar initial; `"Admin User"` → initial `"A"`. Cosmetic improvement.
- `inquiries/page.tsx:283` — `title={inquiry.createdBy.name}` hover tooltip. Value
  changes from `"vistra admin"` to `"Admin User"`. More meaningful, not breaking.
- `projects/page.tsx:293` — same tooltip pattern; same assessment.
- `top-bar-actions.tsx:13` — avatar initial; same as layout.tsx above.

None of these consumers will break; all will show improved values after the seed runs.
The seed is already documented as idempotent/upsert-based — adding a conditional update
before the `continue` extends that contract correctly.

**3. Root cause distinction from prior "closed" investigation — SAME ROOT CAUSE, CORRECTLY FIXED**

The prior developer (UI-pass batch, `19ece12`) flagged the greeting issue for the
distributor user as "seed data, not a code bug, no change." The PV1 fix addresses the
same underlying cause (`displayName` convention predating the `firstName`/`lastName`
split) for the admin user — and extends the fix to all four seed users.

The developer's characterisation of this as a "different user" is accurate in the narrow
sense but the root cause is identical. What changed is the decision: the human explicitly
re-reported the issue in their PV1 check, which overrides the prior "no change" call.
The current fix is the right outcome. No inconsistency concern.

**4. Test falsifiability — SOUND (for the implementation invariant; see MINOR above for the comment)**

The test is falsifiable in the following meaningful scenario: if `dashboard/page.tsx`
were changed to render `session.username`, a hardcoded string, or anything other than
`me.name`, the assertion `expect(greeting).toContainText(me.name)` would fail. Given
that `me.name` post-fix is `"Admin User"`, a greeting showing `"Welcome, admin"` or
`"Welcome, vistra admin"` fails the test.

`orgUrl` and `apiUrl` helpers are confirmed exported from `tests/e2e/helpers.ts` (lines
38 and 58) — available because this branch bases off `staging @ 1c2528d` which includes
the merged subdomain URL fix.

**5. No automated sticky-header test — CONFIRMED**

The diff adds no automated test asserting on DOM structure, layout, scroll behaviour, or
CSS class presence. Sticky header verification is manual-only, per the wireframe rule.

**6. Scope — CLEAN**

Exactly four files changed, matching the plan's file table: `inquiries/page.tsx`,
`projects/page.tsx`, `prisma/seed.ts`, `tests/e2e/stage15-b.spec.ts`. No product
features added. No files outside the stated scope.

No Prisma query shape changed → no `by-page.sql` update required (confirmed correct per
plan).
