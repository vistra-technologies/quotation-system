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

## Stage 3 — Catalog & Pricing Foundation
Automated: `tests/e2e/pricing-stage3.spec.ts` (serial mode, 90 s timeout per test).

13. **MANAGE_PRICING gating — distributor:** `distributor` role navigating to `/{orgSlug}/pricing` is
    server-redirected to `/{orgSlug}/dashboard`; the Pricing Management heading is never rendered.
14. **MANAGE_PRICING gating — architect:** same as item 13 for the `architect` role.
15. **MANAGE_PRICING gating — item edit page:** unauthorized direct navigation to
    `/{orgSlug}/pricing/{itemId}` (any role without MANAGE_PRICING) is redirected to
    `/{orgSlug}/dashboard` before the item is looked up.
16. **Pricing CRUD round-trip (company member):** a `member` (MANAGE_PRICING) can (a) add a new
    `ItemPrice` for a catalog item via the form, (b) update it by submitting the same currency again
    with a different amount (upsert), and (c) delete it; all three changes persist and reflect in the UI.
17. **Seed data integrity:** after `npx prisma db seed`, the DB must have exactly 48 `CatalogItem` rows
    and 96 `ItemPrice` rows (12 items × 4 orgs; 2 currencies × 12 items × 4 orgs). Each org must have
    exactly its own 12 items and 24 prices — no cross-org sharing.
18. **Pricing tenancy isolation:** a session from one org cannot view or mutate another org's catalog
    prices. A cross-org cookie replay on `/{orgSlug2}/pricing` → redirect to `/{orgSlug2}/login`.
19. **next-intl strings:** all Stage 3 user-facing strings in the pricing pages render from the English
    locale dictionary (no hardcoded display text visible in the pricing components, excepting decorative
    UI characters like arrow symbols).
20. **Stage 2 regression after Stage 3 migration:** per-org login, cross-org session rejection,
    role-correct dashboard, and `/api/health` all still pass after the Stage 3 migration is applied.
    (Items 1, 3, 7, 11 verified; item 10 manual only — deactivation test requires a DB write.)
