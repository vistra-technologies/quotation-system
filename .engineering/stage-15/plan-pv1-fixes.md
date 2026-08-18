# Plan — PV1 post-staging visual fixes

**Branch:** `feature/fix-sticky-header-and-greeting`
**Author:** developer, 2026-08-18

---

## Decision flags / deviations

None. Both bugs are within scope of the human's PV1 fix request.

---

## Bug 1 — Table header scrolls with body (sticky `<thead>`)

### Root cause (traced)

Both `inquiries/page.tsx` and `projects/page.tsx` have this DOM structure:

```html
<div class="flex-1 min-h-0 overflow-y-auto px-4">   <!-- scroll container A -->
  <div class="overflow-x-auto">                      <!-- scroll container B (CSS) -->
    <table>
      <thead>...</thead>    <!-- sticky here can't work: nearest scroll container is B,
                                which has no height limit and never scrolls vertically -->
    </table>
  </div>
</div>
```

CSS `position: sticky` on `<thead>` sticks within its nearest scroll container ancestor.
`overflow-x: auto` makes the inner div a scroll container (CSS spec). Since that inner div
has no defined height and never scrolls vertically, sticky positioning within it has no
effect — the element can't "stick" to the top of a container that never overflows.

### Fix

Merge the two scroll contexts into one, then add sticky to `<thead>`:

1. **`app/[orgSlug]/inquiries/page.tsx`**
   - Inner scroll div: `overflow-y-auto` → `overflow-auto` (handles both axes)
   - Remove the `<div className="overflow-x-auto">` wrapper and its closing tag
   - Add `className="sticky top-0 z-10 bg-bg-card"` to `<thead>`

2. **`app/[orgSlug]/projects/page.tsx`** — identical changes

No other list pages have this pattern (confirmed: the only other `overflow-y-auto` occurrences
are `design/page.tsx:74` and `:124`, unrelated aside elements).

### Verification

Manual only (per CLAUDE.md rule 5 — CSS/layout). Tester confirms: on the inquiries and
projects list pages with >10 rows, column labels (PROJECT NAME, COMPANY, etc.) remain visible
at the top while scrolling through rows; body rows scroll underneath the header.

---

## Bug 2 — Dashboard greeting shows wrong name

### Investigation (traced from scratch)

**Dashboard** (`app/[orgSlug]/dashboard/page.tsx`):
- Calls `GET /api/v1/orgs/[orgSlug]/me`
- Renders `Welcome, {me.name ?? me.username}`
- `/me` returns `name: session.name` where `session.name = u.name` from `auth.api.getSession()`
- `u.name` = the `user.name` column in the DB

**Users admin list** (`app/[orgSlug]/admin/users/page.tsx`):
- Calls `GET /api/v1/orgs/[orgSlug]/users` → `listUsers(session)` → Prisma `user.findMany`
- Renders `{user.firstName} {user.lastName}` as "Full Name"

**The mismatch — verified against `prisma/seed.ts`:**

The seed's `userSlots` array (lines 203-236) has for the admin user:
```javascript
{
  username: "admin",
  firstName: "Admin",
  lastName: "User",
  displayName: `${org.slug} admin`,   // e.g. "vistra admin"
  ...
}
```

User creation (line 263) stores `name: slot.displayName` = `"vistra admin"`, NOT
`"${firstName} ${lastName}"` = `"Admin User"`. So the DB has:

| field | value |
|---|---|
| `name` | `"vistra admin"` |
| `firstName` | `"Admin"` |
| `lastName` | `"User"` |

Dashboard reads `name` → shows `"vistra admin"`.
Users list reads `firstName + " " + lastName` → shows `"Admin User"`.

This is **a single account with inconsistent fields** — not two different accounts. The seed's
`displayName` convention predates the `firstName`/`lastName` split added in Batch G; it was
never updated to match.

The existing idempotency check (`if (existing) continue`) means re-running the seed never
fixes existing users — stale `name` persists until the user is explicitly updated.

**This is a seed data inconsistency, not a code bug in `createUser` or `updateUserProfile`**
(both of which correctly set `name = "${firstName} ${lastName}"` for users created via the API).
The dashboard code is correct: it reads the right field. The seed is wrong.

### Fix

**`prisma/seed.ts`:**
1. Change `name: slot.displayName` → `` name: `${slot.firstName} ${slot.lastName}` `` so new
   seed installs use the correct format.
2. Remove the now-unused `displayName` field from each slot in `userSlots`.
3. Change the idempotency block from `if (existing) continue` to: when a user already exists,
   update their `name` field to `${firstName} ${lastName}` before continuing. This fixes stale
   values in the dev Neon branch without a schema migration.

**Run `npx prisma db seed`** locally after the code change to apply the update to the dev
Neon branch (same branch used by staging). Staging's next request picks up the corrected
`name` via `getSession()`, which reads current user fields from the DB on each call.

**`tests/e2e/stage15-b.spec.ts`:**
Add a new test: sign in as "admin" for "acme-glass", hit `/api/v1/orgs/acme-glass/me` to get
the current `me.name`, navigate to the dashboard, assert the greeting contains `me.name` exactly.
The test is falsifiable: if the dashboard reads from a stale/derived source rather than the
current `User.name`, `me.name` ("Admin User" post-fix) would not appear in the greeting —
the test would fail because the greeting would say "Welcome, acme-glass admin" instead.

---

## Files changed

| File | Change |
|---|---|
| `app/[orgSlug]/inquiries/page.tsx` | overflow-auto, remove inner wrapper, sticky `<thead>` |
| `app/[orgSlug]/projects/page.tsx` | same |
| `prisma/seed.ts` | fix `name` field; add update path for existing users |
| `tests/e2e/stage15-b.spec.ts` | add greeting data-correctness test |

No Prisma query shape changes → no `by-page.sql` update needed.
No new i18n namespace → no clientMessages trap risk.

---

## Verification

- **Bug 1:** tester confirms sticky header on `inquiries` and `projects` list pages (manual).
- **Bug 2:** tester runs `stage15-b.spec.ts` greeting test against the preview deployment.
  Also manual: log in as "admin" on any org subdomain, verify greeting shows "Admin User"
  (not "vistra admin" / "acme-glass admin").
