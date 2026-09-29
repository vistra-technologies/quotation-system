# Hotfix: preview-url-routing — worklog

## Status

- Phase: **implement — DONE (preview verified, awaiting review + merge gating)**
- Branch: `hotfix/preview-url-routing` (off `master`)
- Latest artifact: `.engineering/hotfix-preview-url-routing/plan.md`
- Next: human reviews the fix on the preview URL, approves merge to staging → verify on `test.easeetool.com` → human approves merge to `master`

## Work items

N/A — single-branch hotfix, no decomposition expected.

## Activity log

(agents append thin entries below, newest last)

---

**2026-09-19 — developer (investigate + plan)**

- Read `proxy.ts` (repo root, not `middleware.ts`) end-to-end. The `else` branch correctly handles `*.vercel.app` preview URLs via path-segment extraction — the profile.md hypothesis (proxy causes the breakage) is REFUTED.
- Root cause identified in `lib/auth.ts`: `crossSubDomainCookies.enabled = BETTER_AUTH_URL.includes("easeetool.com")`. Since Vercel's Preview tier uses `BETTER_AUTH_URL=https://test.easeetool.com` for both staging and ad-hoc previews, cross-subdomain cookies fire on `*.vercel.app` hosts → browsers reject `Domain=.easeetool.com` cookies → session never stored → auth loop.
- Confirmed via `vercel env ls`: a Preview-tier `BETTER_AUTH_URL` secret exists (created 32d ago), distinct from the Production-tier one (updated 16d ago).
- Plan written: one-line fix in `lib/auth.ts` (`VERCEL_ENV === "production"` instead of `BETTER_AUTH_URL` heuristic). Decision point flagged for human: staging loses cross-org session detection; acceptable or use branch-scoped env var instead.
- Artifact: `.engineering/hotfix-preview-url-routing/plan.md`

---

**2026-09-19 — developer (implement + verify)**

- Human decision: use branch-scoped env var approach (plan.md §4 alternative). Env var `CROSS_SUBDOMAIN_COOKIES_ENABLED=true` already configured in Vercel for Production and for `gitBranch=staging` Preview; unset for all other Preview builds.
- Changed `lib/auth.ts` `crossSubDomainCookies.enabled` from `(process.env.BETTER_AUTH_URL ?? "").includes("easeetool.com")` to `process.env.CROSS_SUBDOMAIN_COOKIES_ENABLED === "true"`. Added detailed comment explaining the root cause and the fix.
- Committed (`cd67d06`) and pushed to `hotfix/preview-url-routing`. Branch was new to remote (first push).
- Vercel deployed to preview: `https://quotation-system-ca40qwklp-vistra-indias-projects.vercel.app` (also aliased as `quotation-system-git-hotfix-previ-f9b2c7-vistra-indias-projects.vercel.app`) — status READY in ~1m 16s.
- Verified:
  - `/api/health` → `{"status":"ok","database":"connected"}` ✓
  - `GET /` → HTTP 200 (org selector) ✓
  - `GET /vistra/login` → HTTP 200 ✓
  - `POST /api/auth/sign-in/email` with `admin@vistra.internal` / `Seed1234!` → HTTP 200, `Set-Cookie: __Secure-qs.session_token=...; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax` — **NO `Domain` attribute** (host-only cookie, fix confirmed) ✓
  - `GET /vistra/dashboard` with session cookie → HTTP 200 (no redirect loop) ✓
- NOT merged — awaiting human review + gating step per CLAUDE.md workflow.

---

**2026-09-19 — reviewer**

- Review-1 complete. Verdict: APPROVE. 0 CRITICAL, 0 IMPORTANT, 0 MINOR.
- Fix is correct, fails safely (false default is a UX degradation not an auth break), comment accurate.
- Artifact: `.engineering/hotfix-preview-url-routing/review-1.md`
