# Worklog — Hotfix 2026-10-10 profile popup

## Status
- Phase: implement, step 4 (review round 2, incremental diff-2.patch 853e30f..512415c)
- Branch: hotfix/profile-popup, worktree .worktrees/hotfix-profile-popup (HEAD d4bba18 at start)
- Spec (approved, locked): quotation-system-docs/development-cycles/stage-30/hotfix-2026-10-10-profile-popup.md
- Signed-off mockup: quotation-system-docs/design-docs/mockups/profile-popup-poc.html
- Profile: .engineering/stage-30/profile.md (reuse; append-only)
- Latest artifact: diff-2.patch, review-1.md
- Open gates: API regression areas on branch preview (developer/tester); full regression on test.easeetool.com after staging merge (test phase)

## Activity log

## developer · 2026-10-10 · Step 2 (setup + plan)
- Worktree `quotation-system/.worktrees/hotfix-profile-popup`, branch `hotfix/profile-popup` @ d4bba18 (== origin/master); `tests/regression/` present. Fetched with explicit refspec.
- `npm ci` + `prisma generate` done (EXIT=0); `.env`, `.env.local`, `.env.playwright.local` copied. Main checkout untouched.
- `tsc --noEmit`: baseline errors only in `tests/e2e/*` (e.g. hotfix-2026-09-27-round4.spec.ts:156 `hasValue`), none in app/lib. `npm run lint`: 0 errors, 9 warnings (baseline).
- Plan: `.engineering/hotfix-profile-popup/plan.md`. Key decisions: widen GET /me, PATCH /me rejects unknown keys (400), reuse updateUserProfile via updateOwnProfile, better-auth changePassword with revokeOtherSessions=true, portal modal + new `account` i18n namespace with provider in org layout.
- Gate: mockup sign-off still pending per spec before H2 component code. Status: DONE_WITH_CONCERNS.

## developer · 2026-10-10 · Step 4 (dev round 1, build)
- Commits ebd7a64 (H1), 918bef9 (H2), 853e30f (H3) on hotfix/profile-popup (base d4bba18); not pushed.
- H1: `lib/own-profile.ts` (pure validation, rejects unknown keys), `getOwnProfile`/`updateOwnProfile` in `lib/data/users.ts` (wrapper over updateUserProfile), `PATCH /me` + GET /me widened (+firstName,lastName,mobile,profileEmail).
- H2: `app/[orgSlug]/account-popup.tsx` (portal modal), `top-bar-actions.tsx` wired (comingSoonText prop removed; `toast.comingSoon` translation kept, `components/toast.tsx` uses it), layout wraps header in NextIntlClientProvider with `account` namespace in `messages/en.json`. Password via `authClient.changePassword({revokeOtherSessions:true})`; wrong pw maps `INVALID_PASSWORD`.
- H3: `tests/regression/api/orgs-me-stats.spec.ts` (keys, PATCH negatives via matrix, happy/rejected-keys/own-row/password tests on throwaway f.user), `tests/regression/journeys/j8-account-popup.spec.ts`, `tests/unit/own-profile.test.ts`.
- Docs: `quotation-system-docs/design-docs/sql-queries/by-page.sql` edited, NOT committed (docs repo has other uncommitted changes).
- Verify: tsc (no errors outside baseline tests/e2e), eslint clean on touched files (1 repo-wide error was mine, fixed), `npm run test:unit` 608/608, `test:regression:coverage` green. Nothing run live.
- Unverified: better-auth change-password Origin/CSRF behaviour in the API test (may need an Origin header), J8 and regression specs never run, popup visuals not seen in a browser.
- Extra vs mockup: external-company chip shown in the popup header when the user has one. Status: DONE_WITH_CONCERNS.

## reviewer · 2026-10-10 · Step 4 (review round 1)
- Verdict: CHANGES-NEEDED. 0 BLOCKER / 2 MAJOR / 4 MINOR / 1 NIT. Report: `.engineering/hotfix-profile-popup/review-1.md`.
- Ran: eslint on touched files (clean), own-profile unit test (7/7), regression coverage map (green). No app/build/suite run.

## developer · fix round 1 · 2026-10-10 (853e30f..HEAD, 3 commits)
- M-1: authPost takes optional headers; trustedOrigin() helper in tests/regression/api/sign-in.ts; change-password calls send Origin.
- M-2/P-8: lib/auth.ts all 6 user additionalFields `input: false` (firstName/lastName/mobile are not better-auth fields, so already unwritable). Repo grep: no use of updateUser/update-user/signUp except disabled sign-up (health-auth spec asserts it); users created via Prisma; authClient used only for signIn/signOut/getSession/listSessions/revokeOtherSessions/changePassword; no inferAdditionalFields. New spec case: update-user with each field -> 400, /me + admin user row unchanged.
- P-9: chip + externalCompanyName prop removed from AccountPopup (top bar keeps its own chip). m-2: J8 asserts menu avatar R->A. m-3: invalid-body cases moved out of the shared-actor matrix into a throwaway-user test. m-4: roles heading restored in by-page.sql (docs, uncommitted). NIT: focus dialog on open, back to Profile btn on close.
- Verify: tsc (only pre-existing tests/e2e/hotfix-2026-09-27-round4.spec.ts error, same on stash), eslint on touched files clean, own-profile unit 7/7, test:regression:coverage green. Nothing run live. Status DONE_WITH_CONCERNS.

## reviewer · 2026-10-10 · Step 4 (review round 2, incremental 853e30f..512415c)
- Verdict: APPROVE-WITH-NITS. 0 CRITICAL / 0 IMPORTANT / 1 MINOR / 3 NIT. Report: `.engineering/hotfix-profile-popup/review-2.md`.
- Static only (git/grep/better-auth dist read); nothing run. All round-1 findings resolved.

## developer · 2026-10-10 · branch-preview verification (hotfix/profile-popup @512415c)
- Deployment quotation-system-5tylf9gv7 READY; build log has /api/v1/orgs/[orgSlug]/me + /[orgSlug] pages. Alias https://quotation-system-git-hotfix-profi-74e1ed-vistra-indias-projects.vercel.app. /api/health ok, database connected.
- `node node_modules/@playwright/test/cli.js test -c playwright.regression.config.ts "tests.regression.api."` with PLAYWRIGHT_BASE_URL=alias: 851 passed / 0 failed / 0 skipped (10.1m); orgs-me-stats 29 pass, health-auth 7, superadmin-auth 43. Log .scratch/hp-api-run1.log.
- Cleanup: created 186 / deleted 186, no stray rgr- rows, globals restored, other-orgs diff clean. Shared users' passwords untouched (password tests use throwaway users; suite signs in as SA + Test Org users throughout, all green). Nothing pushed. Status DONE.

- developer · 2026-10-10 · follow-up P-1: removed "Change Password" dropdown entry + menuChangePassword key (en.json only locale); dropped initialTab prop (popup always opens on Details), popupTab -> popupOpen boolean; J8 now asserts no menu entry and reaches Password via tab, avatar-refresh assertion kept. tsc: only pre-existing error in tests/e2e/hotfix-2026-09-27-round4.spec.ts (untouched); eslint touched files clean; regression:coverage OK. Not pushed. DONE

## tester · 2026-10-10 · test round 1 (staging @ 98c481e, test.easeetool.com)
- Verdict: PASS. 0 CRITICAL / 0 MAJOR / 2 MINOR / 0 NIT. Report: `.engineering/hotfix-profile-popup/bugs-1.md`.
- Full regression: pass 1 1052/1053 (flaky pages.spec.ts:467 ERR_ABORTED), second pass PASS; 0 skipped; cleanup clean. Manual popup/API/tenancy pass clean. Test Org userLimit temporarily raised and restored to 7; throwaway users deleted.
