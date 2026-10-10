<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## next-intl: client namespace wiring is invisible to build/lint/TypeScript

Every route layout that renders `NextIntlClientProvider` builds a `clientMessages` object by hand
(one key per namespace forwarded to client components). If a client component under that route calls
`useTranslations("someNamespace")` and that namespace isn't a key in `clientMessages`, next-intl throws
on hydrate — the component silently fails to mount, with no server-side error, no build failure, no
lint warning, no TypeScript error. This shipped to production once already (Stage 6: `add-selection-form.tsx`
called `useTranslations("selections")`, but `app/[orgSlug]/projects/layout.tsx`'s `clientMessages` never
forwarded that namespace — the whole "Add Component" form was inert in the browser until a real
browser/E2E pass caught it).

**Whenever you add or edit a client component that calls `useTranslations(ns)`,** verify `ns` is a key in
`clientMessages` in the nearest ancestor layout — grep the layout file, don't just trust the component
compiles. This is a check reviewers and testers must do explicitly; it will not surface on its own.

## `/controls` has no `NextIntlClientProvider` — never import `@/components/loading-overlay` there

`@/components/loading-overlay`'s `LoadingOverlay` calls `useTranslations()` unconditionally on mount (not
just when `visible` is true). The `/controls` SuperAdmin console has no i18n provider ancestor, so mounting
it throws immediately and bubbles to `app/global-error.tsx` (the "Something went wrong — Try again" screen).
This exact crash has shipped twice already: once in `permission-toggle-button.tsx` (Stage 16 post-deploy
hotfix, 2026-09-02) and again in `create-user-form.tsx` (Stage 17 item 4b, caught before merge to `staging`).
Both times the fix was the same local, translation-free overlay (a `visible`/`pending`-driven `<div>` with
no `useTranslations()` call) — grep `app/controls/**` for `PendingOverlay` for the pattern to copy. **Any
new `/controls/**` client component needing a loading spinner must use that local pattern, never the shared
component.**

## Cross-subdomain session cookies are driven by `CROSS_SUBDOMAIN_COOKIES_ENABLED`, not `BETTER_AUTH_URL`

`lib/auth.ts` sets `advanced.crossSubDomainCookies` to
`{ enabled: process.env.CROSS_SUBDOMAIN_COOKIES_ENABLED === "true", domain: ".easeetool.com" }`, evaluated once
at `betterAuth()` construction. It is a plain per-environment flag: `BETTER_AUTH_URL` has no part in it (an
earlier `BETTER_AUTH_URL.includes("easeetool.com")` heuristic was replaced because Vercel's Preview tier shares
one `BETTER_AUTH_URL` between the `staging` branch and every ad-hoc `*.vercel.app` branch preview).

Why it matters: with the flag on, the session cookie is `Domain=.easeetool.com`, so one sign-in is shared
across org subdomains (`{orgSlug}.easeetool.com`, `test.easeetool.com`). A browser rejects a cookie whose
`Domain` does not match the serving host (RFC 6265 section 5.3), so on a `*.vercel.app` preview the flag must
be off. Where it is set (checked with `vercel env ls`, names and targets only, 2026-10-10):
`CROSS_SUBDOMAIN_COOKIES_ENABLED=true` on **Production** and on **Preview scoped to the `staging` branch**.
Every other Preview build (feature/hotfix/release branches) has no value, so it is `false` and cookies are
host-only. Local dev also has no value.

**Do not re-diagnose a "sign-in returns 200 but the next page bounces to `/login`" report from scratch.** Curl
`/api/auth/sign-in/email` on the affected host and compare the `Set-Cookie` `Domain` attribute with the request
host. A `Domain=.easeetool.com` cookie on a `*.vercel.app` host means the flag is `true` for that deployment's
environment/branch (it should not be); a missing `Domain` on an `easeetool.com` host means the flag is unset
there. Fix the env var for that target in the Vercel dashboard (it is read at build/start, so redeploy).

<!-- END:nextjs-agent-rules -->

## Logging: `log.*` never `console.*`, wrap new routes and actions (Stage 30)

Use `log.info|warn|error` from `@/lib/logger`, never `console.*` (ESLint `no-console` fails the build in `app/api/**`, `lib/**`, `instrumentation.ts` and every `"use server"` file; client components are exempt). Wrap every new route handler as `export const VERB = withRoute("VERB /path", async (request, ctx) => { ... })` with the exact `covers()` id from `tests/regression/`, and every new server action as `export const act = withAction("<file>#<name>", async (...) => { ... })` (`/api/health` stays unwrapped). Never log bodies, headers, usernames, emails or IPs; pass `{ err }` and let the logger redact. To read logs, query Axiom on `_time` (the `ts` field is consumed as `_time`, so there is no `ts` column), filter by `requestId` (the `x-request-id` response header and the `requestId` in every 500 body), datasets `easeetool-prod` / `easeetool-preview` / `vercel`. Design: `quotation-system-docs/design-docs/05-architecture.md` (Observability).
