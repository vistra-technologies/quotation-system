# Regression checklist

Standing set of conditions verified across past stages. Grows by one condition per stage (owned by
`engineering:test` on each clean PASS). Bootstrapped 2026-07-12 from Stage 1 + Stage 2 test reports, since no
checklist existed yet.

## Stage 1 — Infra scaffold
1. `GET /api/health` → 200, body includes `database: "connected"`.

## Stage 2 — Actors & Authentication
2. `GET /api/auth/ok` → 200 `{"ok":true}`.
3. Sign-in with a seeded user's synthetic email (`{username}@{orgSlug}.internal`) + correct password →
   200, session cookie set.
4. Sign-in with wrong password → 401 `INVALID_EMAIL_OR_PASSWORD`.
5. `POST /api/auth/sign-up/email` (public self-signup) → 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` — signup is
   server-provisioned only.
6. RBAC: each of the 4 roles (Admin, Company Member, Distributor, Architectural Firm) shows exactly its
   matrix-defined permission set on `/{orgSlug}/dashboard`, no more/fewer.
7. Tenancy isolation: a session cookie obtained from one org's login must NOT authenticate against a
   different org's path (cross-org cookie replay against `/{orgSlug2}/dashboard` → redirect to
   `/{orgSlug2}/login`).
8. Apex host strips any client-supplied `x-org-id`/`x-org-slug` headers before the session check (defends
   the apex from spoofed-header session hijack).
9. Path-based routing: apex (`/`) → 200 org selector; known org path (`/{orgSlug}/login`) → 200 login
   page; unknown slug (`/nonexistent/login`) → 404 JSON `{"error":"Organization not found"}`.
10. Instant deactivation: flipping a user's `active` to `false` invalidates their existing session on the
    very next request (redirect to `/{orgSlug}/login`), no wait for expiry.
11. Unauthenticated request to `/{orgSlug}/dashboard` → redirect to `/{orgSlug}/login`.

## Real-browser UI flow
12. From the apex org selector page, clicking an organization link lands the browser on **that org's own
    login page on the same deployed origin** (not `localhost`, regardless of what environment is under
    test) — exercised via the Playwright harness (`npm run test:e2e`, `playwright.config.ts` /
    `tests/e2e/`), not curl. Full flow: apex → click org → login page loads on-origin → sign in with seeded
    creds (`admin` / `Seed1234!`) → dashboard renders with correct username/org/role → sign out →
    redirect to `/{orgSlug}/login`. Note: requires `BETTER_AUTH_URL` to be configured for the target
    environment (see Stage 2 bug report); currently verified only via curl (items 1–11 above).
