# Review — Stage 12 Batch 7c (Inquiries shared list-page pattern + org-switcher→external-company-filter correction)

**Diff:** `diff-batch7c.patch` (merge-base against `release/stage-12`)
**Commit under review:** `5f6a264` (original build) + correction on `feature/batch7c-inquiries-list-pattern`

---

## Priority checks (all passed)

**Tenancy — externalCompanyId filter is strictly additive**

`listInquiriesPaginated` in `lib/data/inquiries.ts` builds its where clause as an AND array. The first
element is always `{ organizationId: session.organizationId }` — unconditional, never overridden. The
URL-param-derived `externalCompanyId` filter is pushed only when `params.externalCompanyId` is truthy AND
`session.externalCompanyId === null` (the internal-user guard). External users already have
`{ externalCompanyId: session.externalCompanyId }` pushed from the server-side session (the `scope=all`
branch), so the URL param is ignored for them entirely. Both branches sit inside the unconditional org
filter. No code path reaches the Prisma call without `organizationId: session.organizationId` in play.
Correct.

**No residual cross-org capability**

`components/list-page-controls.tsx` (new file) contains no `OrgOption`, no `orgs` prop, no
`currentOrgSlug`, no `router.push` to another org's URL path. `handleCompanyChange` calls
`navigate({ externalCompanyId: id })` — stays on the same pathname. The `/api/v1/orgs` (public
org-selector list) fetch that the original org-switcher required was removed from `page.tsx`; the only
fetches in the corrected page are `/me`, `/inquiries?…`, and (internal users only)
`/api/v1/orgs/${orgSlug}/external-companies`. Correct.

**Route handler contracts**

`GET /inquiries` route follows the canonical `getApiSession` + error-catch pattern, uses `lib/api-error.ts`
factories, calls `listInquiriesPaginated` from `lib/data/inquiries.ts` (no direct Prisma). Page has no
`@/lib/data/*` imports — only `internalFetch`, `orgHref`, and the shared UI component. `lib/api-auth.ts`
and `lib/api-error.ts` frozen contracts respected byte-for-byte. `npx tsc --noEmit` 0 errors / `npm run
lint` 0 errors. Pagination math correct. Date-range presets computed server-side in UTC. `/external-companies`
response shape (`{ companies }`) matches the page's type cast.

`SessionData.externalCompanyId` confirmed present in `lib/session.ts` and identically shaped in
`getApiSession()`'s return value.

---

## Findings

**[MINOR-1]** `handleScopeChange` preserves `externalCompanyId` in URL when toggling to "mine" scope —
silent filter applied invisibly. `navigate({ scope: s })` preserves all existing URL params. When a user
viewing "All" scope with a company filter active clicks "My Inquiries", the dropdown hides but
`?externalCompanyId=X` remains, and the DAL still applies it for internal users regardless of scope — the
user is left silently filtered with no visible control to clear it. Related: the empty-state check omits
`externalCompanyId`, so a company-only filter with zero results shows the generic "create your first
inquiry" message instead of a "no matches" message.

**[MINOR-2]** Debounce timer (`debounceRef`) not cleared on component unmount — benign in Next.js/React 19
(a stray `router.push` on an already-unmounted route), but a best-practice gap.

**[MINOR-3]** `stage-12.md`'s plan section still describes the feature as an "organization-switcher
dropdown" — the human's mid-batch correction was recorded in the worklog but the plan prose itself wasn't
updated to match what was actually built.

---

## Verdict: APPROVE-WITH-NITS

The correction is complete and correctly implemented. The tenancy path is solid: the org-level scope is
unconditional, the external-company filter is additive and gated on the server-side session discriminator,
and no cross-org navigation capability remains. All three findings are MINOR — none affect correctness or
security. MINOR-1 is worth taking (small, clear UX-confusion fix); MINOR-2/3 are developer's discretion.
