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

## `BETTER_AUTH_URL`-driven cross-subdomain cookies are structurally incompatible with ad-hoc branch previews

`lib/auth.ts`'s `crossSubDomainCookies.enabled`/`.domain` are computed **once**, at `betterAuth()`
construction, from `process.env.BETTER_AUTH_URL` — a single static value per Vercel environment (Production /
Preview / Development), not something resolved per-request from the actual inbound Host header (better-auth
does support a "dynamic baseURL" config for this — see `isDynamicBaseURLConfig`/`resolveBaseURL` in
`node_modules/better-auth/dist/utils/url.mjs` — but `lib/auth.ts` does not currently use it).

Consequence, confirmed empirically 2026-09-03 by curling `/api/auth/sign-in/email` directly on a
release-branch ad-hoc preview: the response set
`Set-Cookie: __Secure-qs.session_token=...; Domain=.easeetool.com; ...` even though the deployment's own
host was `quotation-system-<hash>-vistra-indias-projects.vercel.app`. A browser silently drops a cookie whose
`Domain` doesn't match the serving host (RFC 6265 §5.3) — sign-in returns 200 with a valid user payload, but
no session survives the redirect, so the next page load bounces back to `/login`. This reproduces on
**every** ad-hoc `feature/*`/`release/*` branch preview whenever the shared Preview-environment
`BETTER_AUTH_URL` value contains `easeetool.com` (e.g. `https://test.easeetool.com`, set for exactly this
reason in Stage 15) — which is required to make `test.easeetool.com` itself share cookies across org
subdomains. **The two requirements cannot both be satisfied by one static env value**, so whichever was fixed
last is currently broken: this has been logged and "fixed" as a one-off devops env-var tweak at least four
times already (Stage 2 review round, Stage 10 Batch 2, Stage 13 H1, Stage 15 Round 2) and will keep
recurring on every ad-hoc preview until `crossSubDomainCookies` is driven per-request instead of per-environment.

**Do not re-diagnose this from scratch.** If browser sign-in on a feature/release branch's own preview
"succeeds" (200, user JSON) but the next request is unauthenticated: curl the sign-in endpoint directly and
check the `Set-Cookie` header's `Domain` attribute against the actual request host — if they don't match,
this is that bug, not a new one. **The real fix** (not yet built — needs a proper implement pass, since it
touches production auth-cookie behavior): make `crossSubDomainCookies` resolve per-request from the inbound
Host header (via better-auth's dynamic-baseURL support, or an equivalent per-request override) instead of a
build-time env var, so a single deployment can correctly serve both `*.easeetool.com` hosts and ad-hoc
`*.vercel.app` preview hosts at once.
<!-- END:nextjs-agent-rules -->
