# Batch 7g — User Management: Plan

**Branch:** `feature/batch7g-user-management`
**Status: BLOCKED — schema fields missing (see below)**

---

## BLOCKED: Schema fields required by the stage doc do not exist

The stage doc mandates these form fields:
- **Mandatory:** First Name, Last Name, Username, Password, Role
- **Optional:** Mobile, Email

Audited `prisma/schema.prisma` User model. Findings:

| Required field | Schema field | Present? |
|---|---|---|
| First Name | `firstName` | NO — only `name` (single field) exists |
| Last Name | `lastName` | NO — only `name` (single field) exists |
| Mobile | `mobile` | NO |
| Email (optional) | `profileEmail String?` | YES — `profileEmail` already exists |
| Username | `username` | YES |
| Password | via `Account.password` (hashed) | YES |
| Role | `roleId` | YES |

Three schema columns are missing: `firstName`, `lastName`, `mobile`. The current `name` field
is set to `username` in `createUser` (`lib/data/users.ts:107`) — it is a better-auth core
field, not a display-name field.

### What a fix would require
- Add to `prisma/schema.prisma` `User` model: `firstName String?`, `lastName String?`,
  `mobile String?` (all nullable since existing rows have none of these).
- Run `npx prisma migrate dev` against the Neon dev DB to produce and apply the migration.
- Update `lib/data/users.ts` `CreateUserInput` and `createUser()` to accept + write the
  new fields.
- Update the POST `/api/v1/orgs/[orgSlug]/users` route handler to parse + forward them.
- Update `create-user-form.tsx`, `actions.ts`, `page.tsx` (list), `[userId]/page.tsx` (detail)
  to use the new columns.
- Update `lib/data/users.ts` `listUsers` and `getUserById` to select/return the new fields.
- Optionally decide what `name` should hold going forward (keep `name = username` as the
  better-auth display name, store firstName/lastName separately — or rename `name` to
  `firstName + ' ' + lastName`).

### Why I am not proceeding unilaterally
- A schema migration against the live Neon dev DB is an irreversible, higher-risk operation.
- The existing `name` field is a better-auth core field; its intended shape post-migration
  (kept as username alias vs. replaced by firstName+lastName) is a real design decision.
- The stage doc instructions explicitly say: "If the schema is missing required fields
  (firstName/lastName/mobile), STOP and report BLOCKED — do not write a migration without
  explicit sign-off."

### Options for the human/architect to decide
1. **Add nullable `firstName?`, `lastName?`, `mobile?` columns; keep `name = username` as
   the better-auth display key.** Safest: backward-compatible, no existing rows break.
   The form collects firstName+lastName; the detail page displays them; `name` stays as
   the synthetic auth display field. This is my lean.
2. **Store full name in the existing `name` field** (e.g. `firstName + ' ' + lastName`)
   and add only `mobile?`. Would repurpose a better-auth core field away from its current
   use (set to `username`). More disruptive; better-auth may display or use `name` in ways
   that assume it matches the login identity.
3. **Defer First Name / Last Name / Mobile to a later stage** and implement only the parts
   of Batch 7g that work with existing schema (password min-8 validation, column set changes
   using the existing `name` field, delete-with-confirm). Requires human sign-off on the
   reduced scope.

---

## What CAN be implemented without schema changes (for reference only — not doing without sign-off)

These parts of Batch 7g work with the existing schema:
- Password validation: min-8 characters (client + server-side) — works today, just needs
  enforcement added to the form and route handler.
- List columns: Username, Role, Status plus "Edit" and **Delete** row actions with
  confirmation. Delete requires a new `DELETE /api/v1/orgs/[orgSlug]/users/[userId]` route
  + `deleteUser` action in `actions.ts` + `deleteUser` DAL function — none currently exist.
  No schema change needed.
- Full Name column: would show `user.name` (currently = username) without firstName/lastName
  separately — misleading, since it's the same value as Username.
- Detail page: can surface `profileEmail` (existing) but not firstName/lastName/mobile.
- Confirm-dialog pattern: no existing `window.confirm`/`ConfirmDialog` pattern found in
  the app; would need to be added (simplest approach: `window.confirm()` in a client
  component, or a simple inline state-based modal following the existing `useActionState`
  Client Component pattern).

---

## Files that would change (once unblocked)

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `firstName String?`, `lastName String?`, `mobile String?` to User model |
| `prisma/migrations/` | New migration file from `prisma migrate dev` |
| `lib/data/users.ts` | `CreateUserInput` + `createUser()` + `listUsers` + `getUserById` field shapes |
| `app/api/v1/orgs/[orgSlug]/users/route.ts` | Parse + validate firstName, lastName, mobile; min-8 password check |
| `app/api/v1/orgs/[orgSlug]/users/[userId]/route.ts` | Route and GET unchanged structure, but returns new fields |
| `app/[orgSlug]/admin/users/new/create-user-form.tsx` | Add firstName, lastName (required), mobile, email (optional); min-8 client validation |
| `app/[orgSlug]/admin/users/actions.ts` | `createUser` parses new fields; add `deleteUser` action |
| `app/[orgSlug]/admin/users/page.tsx` | Add Full Name column, delete-with-confirm row action |
| `app/[orgSlug]/admin/users/[userId]/page.tsx` | Display firstName, lastName, mobile, profileEmail in detail metadata block |
| `app/api/v1/orgs/[orgSlug]/users/[userId]/route.ts` | Add DELETE handler |
| `quotation-system-docs/design-docs/sql-queries/by-page.sql` | Update user routes SQL to reflect new fields |

## What I reused / checked

- `prisma/schema.prisma` — `User` model field audit (lines 69–103).
- `lib/data/users.ts` — `CreateUserInput`, `createUser`, `listUsers`, `getUserById` shapes.
- `app/api/v1/orgs/[orgSlug]/users/route.ts` — POST body parsing, field validation.
- `app/[orgSlug]/admin/users/new/create-user-form.tsx` — current form fields.
- `app/[orgSlug]/admin/users/page.tsx` — current column set.
- `app/[orgSlug]/admin/users/[userId]/page.tsx` — current detail metadata.
- `app/[orgSlug]/admin/users/actions.ts` — current action signatures.
- Confirm-dialog pattern search: no `window.confirm`, `ConfirmDialog`, or similar pattern
  found in `app/**/*.tsx`. If/when unblocked, simplest approach is `window.confirm()` in
  a small client component wrapper, consistent with no existing pattern to reuse.
