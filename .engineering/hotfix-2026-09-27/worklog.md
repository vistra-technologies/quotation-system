# Worklog — hotfix-2026-09-27

## Status
Test R6 complete — PASS (0 CRITICAL, 0 MAJOR, 0 MINOR). H-18/H-19/H-20 confirmed. Ready for staging merge.

---

## Entries

### 2026-09-27 · engineering:test · Round 1
- Role: tester
- Verdict: **FAIL**
- Issues: 1 CRITICAL · 0 MAJOR · 1 MINOR
- CRITICAL: H-6 Delete inventory item — DELETE API route missing in `app/api/v1/orgs/[orgSlug]/inventory/[itemId]/route.ts`, returns 405. Delete button shows in UI but always fails when confirmed.
- MINOR: `inventory-popup.spec.ts` B8-1 has stale Active toggle assertion (H-3 removed the toggle, spec wasn't updated).
- H-1 through H-7, H-9 all confirmed PASS. H-8 IMPORTANT-3 revalidation fix confirmed in source.
- Preview tested: `https://quotation-system-20oluxyws-vistra-indias-projects.vercel.app` (HEAD `388a3ee`)
- Report: `.engineering/hotfix-2026-09-27/bugs-1.md`

### 2026-09-27 · engineering:test · Round 2
- Role: tester
- Verdict: **PASS**
- Issues: 0 CRITICAL · 0 MAJOR · 0 MINOR
- H-6 DELETE handler confirmed working: 401 without auth (handler exists), 204 on authenticated delete, 404 on subsequent GET (item gone). Full create→delete round-trip verified.
- B8-1 assertion fix confirmed in source: `not.toBeVisible()` replaces stale `aria-checked="true"`. Playwright run fails at sign-in (acme-glass absent from dev DB, pre-existing harness gap, not a regression).
- Round 1 leftover test items `e2e-hf27-test-001` and `e2e-hf27-del-test-2` deleted and confirmed gone.
- Preview tested: `https://quotation-system-jx0z2rj9q-vistra-indias-projects.vercel.app` (HEAD `059a4da`)
- Report: `.engineering/hotfix-2026-09-27/bugs-2.md`

### 2026-09-27 · engineering:test · Round 3
- Role: tester
- Verdict: **PASS**
- Issues: 0 CRITICAL · 0 MAJOR · 0 MINOR
- All 4 live-discovered bugs (Bugs 1–4) confirmed fixed via actual browser-driven Playwright UI interaction against the `2c11955` preview (`enoqfc4kh`).
- inventory-popup.spec.ts: still fails at sign-in on preview (acme-glass absent from dev DB) — pre-existing harness gap, same as R1/R2; all spec flows covered via e2e-testorg manual Playwright run.
- H-6 Delete regression confirmed working. H-1/H-7 route regressions confirmed working.
- Preview tested: `https://quotation-system-enoqfc4kh-vistra-indias-projects.vercel.app` (HEAD `2c11955`)
- Report: `.engineering/hotfix-2026-09-27/bugs-3.md`

### 2026-09-28 · engineering:test · Round 6
- Role: tester
- Verdict: **PASS**
- Issues: 0 CRITICAL · 0 MAJOR · 0 MINOR
- H-18 SelectField position:fixed confirmed in SA + org-admin Edit User modals and inventory sort dropdown. "Update User" title + username subtitle confirmed in both modals. Org-admin password set → new-password login returns 200. Blank password safe no-op.
- H-19 2-column grid confirmed in both SA and org-admin Add User forms (computed gridTemplateColumns at 1280px). Full create round-trip verified in org-admin.
- H-20 "Sort by:" label and SelectField combobox confirmed on inventory page with all 3 options.
- Regression H-15/H-16/H-17 all clean.
- Test file committed: `tests/e2e/hotfix-2026-09-27-round6.spec.ts` (commit `dc9c46a`)
- Preview tested: `https://quotation-system-c6elkpzr7-vistra-indias-projects.vercel.app` (HEAD `6503f25`)
- Report: `.engineering/hotfix-2026-09-27/bugs-6.md`
