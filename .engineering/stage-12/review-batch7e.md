# Review — Stage 12 Batch 7e (Orders — shared list-page pattern, empty dataset)

**Branch:** `feature/batch7e-orders-list-pattern`, commit `d07d9bd` (+ reviewer cleanup commit `ab69040`)

## Finding 1 — Dead-code claim verified and file deleted (informational, no severity)

`app/[orgSlug]/orders/orders-placeholder.tsx` existed and contained `MOCK_ORDERS` hardcoded fake data.
Grep across the entire worktree confirmed zero callers — `page.tsx` removed its only import in this batch.
The developer's "cannot delete with available file tools" claim reflects a genuine tool constraint (the
`[orgSlug]` bracket path can cause issues with some tool invocations), but the file was trivially removable
with `rm`. Deleted by reviewer; committed as `ab69040` on the branch.

## Priority checks — all PASS

**1. No fabricated data/backend**

`app/api/v1/orgs/[orgSlug]/orders/route.ts` is an honest stub: calls `getApiSession`, then returns
`NextResponse.json({ orders: [], total: 0, page, pageSize })`. No fake rows, no seeded data, no Order model
reference, no DAL import. The `orders-placeholder.tsx` file with `MOCK_ORDERS` was dead (not imported) and
is now deleted. The new `page.tsx` consumes the real API response and renders the appropriate empty-state
message. Clean.

**2. RBAC / auth consistency**

The route calls `await getApiSession(request, orgSlug)` in the canonical try/catch pattern matching every
other Batch 1-7 route handler. Auth-only (no RBAC permission gate beyond authentication) — matches the spec
and is consistent with projects/inquiries. The page's own auth guard mirrors inquiries/projects exactly:
401/403 → redirect to login, `!ok` → `notFound()`. Frozen infrastructure files (`lib/api-auth.ts`,
`lib/api-error.ts`, `lib/internal-fetch.ts`) confirmed untouched by Batch 7e via merge-base diff.

**3. UI/chrome consistency with Inquiries/Projects**

Spec column schema from `stage-12.md`: Project Name, Client Name (external) / Company (internal), Location,
Status, Value, Created On, Submission Date. Remove edit/delete row actions.

Implemented columns match exactly, in order. No checkboxes, no edit/delete actions, no "New Order" button,
no "Export" button. `ListPageControls`/`ListPagePagination` imported unchanged. Margins
(`max-w-[1180px] px-8 pt-7 pb-12`) match Batch 7c's inquiries layout. Parallel `/me` + `/orders` fetch,
external-companies fetch for internal users — structurally identical to `inquiries/page.tsx`.

**4. `common` namespace / next-intl wiring**

`layout.tsx` now forwards `{ common: allMessages.common }`. Confirmed `messages/en.json` has a `common` key.
Confirmed `list-page-controls.tsx` uses neither `useTranslations` nor Toast. The `toast` → `common` switch
is correct — the old forwarding was there only for the now-deleted placeholder's `Toast` usage; no current
child uses `common` either, so this is a safe future baseline, not a broken wire.

**5. Standard checks**

- `npx tsc --noEmit`: 0 errors.
- `npm run lint`: 0 errors.
- `lib/api-auth.ts` / `lib/api-error.ts` / `lib/internal-fetch.ts`: untouched.
- No `@/lib/data/*` or direct Prisma imports in any new or modified file.

## Verdict: APPROVE

0 CRITICAL · 0 IMPORTANT · 0 MINOR. The batch does exactly what it was asked to do: applies the shared
list-page pattern to the Orders page using an empty dataset, with correct auth, correct column schema, no
fake data, no dead code (removed). Clear to merge.
