# Stage 16 (pre-scope) — SuperAdmin / platform-level controls

**Status:** DIRECTION AGREED, NOT SCOPED. Captured 2026-08-14 so the decisions aren't lost.
Full scoping runs via `engineering:stage-prep` after Stage 15 ships.

**Origin:** human request during Stage 15 prep. Deliberately split out of Stage 15 (which stays a
pure bug-fix stage) because this is a new, security-sensitive auth surface and ~25–35h of work.

---

## The ask, verbatim in substance

Introduce **SuperAdmins** who hold accounts at the **EaseeTool platform level** (not inside any org).
They log in at **`easeetool.com/controls`** and reach a dashboard with control over **all orgs**.
**Roles and permissions administration moves to this console**, out of the per-org admin UI.
Three bootstrap accounts, seeded: `devadmin`, `ishan`, `shaji`. Passwords stored hashed.

---

## Decisions locked with the human (2026-08-14)

| # | Decision | Chosen | Consequence |
|---|---|---|---|
| 1 | **Roles model** | **Keep roles per-org; manage them from the SuperAdmin console with an org picker.** | No schema change to `Role`, no migration. Orgs keep the ability to differ. Org admins lose the roles/permissions screens. |
| 2 | **Authentication** | **Reuse better-auth with a reserved non-org platform identity.** | Inherits scrypt hashing, session rotation, secure cookies. One auth system, not two. The `SuperAdmin` table stays separate from `User`. |
| 3 | **Bootstrap credentials** | **Env vars, hashed at seed time.** | Seed reads `SUPERADMIN_*_PASSWORD` from the environment and persists only the hash. **No plaintext in git** — the repo is public. Requires one-time env-var setup in Vercel. |
| 4 | **Stage placement** | **Its own stage (16), after Stage 15.** | Stage 15 promotes with 13/14 as planned. This gets its own review attention. |

---

## Ground truth established during Stage 15 prep (verified against code, not assumed)

### Permissions are already global; roles are not

- `Permission` — **no `organizationId`**, `code` is globally `@unique` (`prisma/schema.prisma:163–168`).
  Platform-level already. This is also *why* E2E-generated permissions leak into every org's admin UI
  (Stage 15 item U6).
- `Role` — **per-org**, `organizationId` + `@@unique([organizationId, name])`
  (`prisma/schema.prisma:171–180`). Every org carries its own "Admin" row.
- `RolePermission` — junction; inherits org scoping through `Role`.

So "move roles **and** permissions up" is **not symmetric**. Permissions are already there; roles are
being *administered* from above while remaining org-owned (decision 1).

### `/controls` is currently hard-404'd

`proxy.ts` rejects **every non-root path on apex hosts** before any DB lookup — deliberately, recorded as
BUG-3 (`bugs-2.md`, 2026-07-23), to stop path-based org routing on apex. `/controls` needs an **explicit
carve-out ahead of that guard**.

`tests/e2e/subdomain-routing.spec.ts:78` asserts `apex/<non-root-path> → 404 JSON`. That spec must be
**narrowed to exclude `/controls`**, not deleted — the guard it protects is still correct for every other
path.

### A cross-org dashboard inverts the app's core invariant

All data access goes through `lib/data/*.ts` with **lint-enforced `organizationId` filtering** (Stage 5).
A SuperAdmin dashboard reads across orgs by definition.

**Requirement:** SuperAdmin reads go down a **separate, explicitly-marked data path**. Do **not** relax the
existing tenancy lint rule to accommodate them — that would silently disarm the guarantee for the whole
application. This is the single biggest architectural risk in the stage.

### Auth identity shape

better-auth currently keys users by a synthetic email `{username}@{orgSlug}.internal`
(`prisma/schema.prisma:86–88`). A platform identity extends this cleanly as `{username}@platform.internal`
— no org, and it cannot collide with a real org slug provided `platform` is reserved.

---

## Security posture (agreed)

- **"Encrypt" means hash.** One-way, slow KDF — scrypt via better-auth. Never reversible, never logged.
- The three bootstrap passwords were shared in plaintext over chat. Treat them as **bootstrap-only** and
  **rotate after first login**.
- `/controls` becomes **the highest-privilege door in the system** — one login, every org's data. It
  deserves stronger treatment than a tenant login.
- **Deferred, worth revisiting at scoping:** TOTP/2FA on `/controls` (better-auth has a plugin), rate
  limiting distinct from the tenant login's 3-per-10s, and an audit trail of SuperAdmin actions. None
  were approved; all were raised.

---

## Open questions for `engineering:stage-prep` on Stage 16

1. **What does the dashboard actually do** beyond roles/permissions? Org list? Create/suspend an org?
   Cross-org user search? Platform-wide metrics? The request says "control over all orgs" — that needs
   an explicit, bounded feature list.
2. **Can a SuperAdmin act inside an org** (impersonation / support access)? Large security implications;
   assume **no** until decided.
3. **Do org admins lose the roles/permissions screens entirely**, or keep read-only visibility of their
   own org's roles?
4. Is `SuperAdmin` a table with a **role/permission model of its own**, or are all SuperAdmins equal?
5. **Audit logging** — if a SuperAdmin edits another org's data, is that recorded anywhere?

---

## Interaction with Stage 15 (checked — no conflict)

Stage 15 item **U6** cleans up E2E-generated permissions (test teardown + one-time purge). That fix is
correct regardless of where the permissions UI eventually lives, so it is **not** wasted work.
**U1/U2** (row-action icon boxes) target the Users and External Companies lists, **not** the permissions
page. No rework risk identified.
