# Plan — Human UI-pass bug fixes (post-staging review)

**Branch:** `feature/fix-subdomain-auth-and-breadcrumb` (already has breadcrumb fix `166f027`)
**Author:** developer, 2026-08-18

---

## Decision flags / deviations

None. All 7 items are within scope as described by the human. Item 1 (seed data) is flagged as a
non-code finding, not fixed. Item 7 is explicitly approved by the human in the task description.

---

## Item 1 — Dashboard greeting "vistra distributor" — SEED DATA, NOT A CODE BUG

**Finding:** `app/[orgSlug]/dashboard/page.tsx` uses `displayName = me.name ?? me.username` and
renders `Welcome, {displayName}`. The `/api/v1/orgs/[orgSlug]/me` route returns
`name: session.name` which is the raw value stored in the `user.name` column. The seed file
(`prisma/seed.ts:225`) sets this to `displayName: \`${org.slug} distributor\`` (i.e., "vistra distributor"
for the vistra org's distributor user).

**Conclusion:** Code is correct. The greeting component shows only the user's name — it does NOT
prepend the org name. "vistra distributor" is the seed user's literal `name` field value. This is a
seed data issue; if the demo user should display differently, the seed's `displayName` value needs
to be changed, not the greeting component. I will NOT speculatively rename seed data.

**Action:** Flag in worklog only, no code change.

---

## Item 2 — Dashboard spacing (chips vs home button gap)

**File:** `app/[orgSlug]/top-bar-actions.tsx`

**Change:** The outer `<div className="flex items-center gap-2">` applies `gap-2` (8px) between all
children: org chip, optional company chip, Home link, Profile button. Add `ml-2` to the Home `<Link>`
button to insert an additional 8px gap between the last chip and the Home button, bringing the visual
separation from 8px to ~16px. This is a single attribute addition to one element.

---

## Item 3 — List pages require scrolling before pagination visible

**Files changed (5):**
1. `app/[orgSlug]/layout.tsx` — `min-h-screen` → `h-screen` (so `main flex-1` has a defined height)
2. `app/[orgSlug]/inquiries/layout.tsx` — add `h-full flex flex-col` to inner div; reduce `pb-12` → `pb-4`
3. `app/[orgSlug]/projects/layout.tsx` — same as (2)
4. `app/[orgSlug]/inquiries/page.tsx` — flex restructure: outer div gets `flex flex-col h-full`;
   table card gets `flex flex-col flex-1 min-h-0`; inner table wrapper div gets `flex-1 overflow-y-auto min-h-0`
5. `app/[orgSlug]/projects/page.tsx` — same restructure as (4)

**Rationale for `h-screen`:** The sidebar is already `sticky top-0 h-screen shrink-0` — the outer
div's `min-h-screen` vs `h-screen` distinction only matters for the right column. With `h-screen`,
`main flex-1 overflow-auto` gets a constrained height (viewport minus header), so `h-full` on
descendants resolves correctly. With `min-h-screen`, the outer div can grow taller than the viewport
and `h-full` children can't use it as a fixed reference point.

**No admin/users restructure needed:** `admin/users/page.tsx` has no pagination component. Admin
list does not use `ListPagePagination`. The admin layout's `py-8` is already smaller than inquiries/
projects layouts' `pb-12`, so it's less of an issue.

**Scope:** only the two layouts + two list pages + the shared org layout.

---

## Item 4 — Pagination bar spacing from table

**File:** `components/list-page-controls.tsx` (`ListPagePagination` component)

**Change:** The `ListPagePagination` wrapper div has class `flex items-center justify-center px-3 pt-3`.
Change to `flex items-center justify-center border-t border-border px-3 py-3`. This adds a visual
separator line (`border-t border-border`) and makes spacing symmetrical (`py-3` vs just `pt-3`).
Applied once in the shared component — automatically fixes spacing on all list pages.

---

## Item 5 — "Back to Projects" link position (must render ABOVE breadcrumb)

**Files changed (2):**
1. `app/[orgSlug]/projects/[projectId]/layout.tsx` — add "← Back to Projects" Link above
   `<ProjectWizardBreadcrumb>`. Import `Link` from "next/link"; compute `base = await orgHref(orgSlug, "")`;
   add `<Link href={`${base}/projects`}>` with the same styling as the current page-level link.
   Text hardcoded as "← Back to Projects" (matching the `backToList` translation value exactly).
2. `app/[orgSlug]/projects/[projectId]/page.tsx` — remove the top-level "← Back to Projects" `<Link>`
   (lines ~75–81). Keep the "Back to Projects" button inside Card 3's footer — that is a different
   UI element (styled as a button, not a text link) and is not what the human referred to.

**Note:** Moving the link to the layout makes it appear on ALL project wizard steps (Project Details,
Configuration, Design, Summary, Quotation). This is the correct behavior — the back link should
always be accessible above the breadcrumb, not just on step 1.

---

## Item 6 — Field label "#" → "Project Number"

**File:** `messages/en.json`

**Change:** `projects.colNumber` from `"#"` to `"Project Number"`.

**Scope check:** `colNumber` in the `projects` namespace is used in exactly two places:
- `app/[orgSlug]/projects/[projectId]/page.tsx:118` (Project Details page read-only field)
- THAT IS ALL — confirmed by grep; the projects list page does NOT use this key.

The `inquiries.colNumber` ("# ") is separate and unchanged (used in `inquiries/[inquiryId]/page.tsx`).

---

## Item 7 — Breadcrumb: green "completed" visual state

**File:** `app/[orgSlug]/projects/[projectId]/project-wizard-breadcrumb.tsx`

**Finding:** The `isDone` logic is already implemented (`activeIndex > -1 && index < activeIndex`).
After the `166f027` fix (which made `activeIndex` compute correctly in subdomain mode), completed
steps now get `isDone = true`. However, the current `isDone` styling has **no background** —
only `text-primary-dark`. The human wants green background.

**Change:** Update only the `isDone` branch's className and the checkmark icon's color:

Before:
```tsx
: isDone
  ? "flex items-center gap-2 rounded-pill px-5 py-2.5 text-sm font-bold text-primary-dark"
```

After:
```tsx
: isDone
  ? "flex items-center gap-2 rounded-pill bg-status-paid-bg px-5 py-2.5 text-sm font-bold text-status-paid-text"
```

And checkmark span, before:
```tsx
className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs text-primary"
```

After:
```tsx
className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-status-paid-bg text-xs text-status-paid-text"
```

**Token choice:** `bg-status-paid-bg` (`#D4F1D4`, light green) + `text-status-paid-text` (`#2E6B34`,
dark green). These are the same tokens used in the "Active/New" status badge in the inquiries list —
the existing green accent in this UI. No new color tokens introduced.

---

## Verification (for tester against preview deployment)

1. **Item 1 (seed data):** Login as `admin@vistra.internal` (admin user) — greeting should say
   "Welcome, Vistra Admin" (whatever name the admin seed user has). Login as distributor — sees
   "Welcome, vistra distributor" (seed data unchanged).
2. **Item 2:** Navigate to any `/{orgSlug}/dashboard`. Observe wider gap between the org chip
   group and the home icon button in the top bar.
3. **Item 3:** Navigate to `/{orgSlug}/inquiries`. On a 900px+ height screen, the pagination
   control (if total > 10) should be visible without scrolling. The table area scrolls internally
   if there are many rows.
4. **Item 4:** On any list page with >10 records, the pagination bar should have a visible
   separator line and consistent spacing below the last table row.
5. **Item 5:** Navigate to any project wizard page. The "← Back to Projects" link should appear
   above the horizontal step breadcrumb.
6. **Item 6:** On the Project Details page for any project, the field previously labeled "#"
   (showing "JOB-2" or "#58") should now be labeled "Project Number".
7. **Item 7:** Navigate to Step 2+ in the project wizard. The previously visited steps (Step 1,
   etc.) should show a green pill background with dark green text and checkmark, distinct from the
   active step (primary-colored) and future steps (muted).
