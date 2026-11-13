# Worklog — hotfix/configure-advanced-field-autoselect

## Status
Narrow re-test R5 PASS — H-4-esc fix confirmed at commit 982bb0b. 0 CRITICAL · 0 MAJOR · 0 MINOR. Ready for merge.

---

## Entries

### 2026-10-01 · engineering:test · Round 1
- Role: tester
- Verdict: **PASS**
- Issues: 0 CRITICAL · 0 MAJOR · 0 MINOR
- Fix confirmed: Partition type with all-single-option advanced fields (u_profile, i_profile, etc.)
  can be added via "Add Component" without opening the Configure panel — no "is required" error.
- T2: Configure panel still shows auto-selected disabled fields correctly.
- T3: Multi-option advanced fields (Door's hasFrame/hasLeaf with Yes/No) still require user input —
  required-field validation not regressed.
- T4: Edit flow (pre-fill existing Selection) still works correctly.
- Playwright test committed: `tests/e2e/hotfix-configure-advanced-autoselect.spec.ts`
- Test data (project b4f5d21e-...) created and deleted; confirmed clean.
- Preview tested: `https://quotation-system-edf6j6nlh-vistra-indias-projects.vercel.app`
- Report: `.engineering/hotfix-configure-advanced-autoselect/bugs-1.md`

### 2026-10-01 · engineering:test · Round 2 (staging)
- Role: tester
- Verdict: **PASS**
- Issues: 0 CRITICAL · 0 MAJOR · 0 MINOR
- Environment: `test.easeetool.com` (staging), deployment `dpl_Gt1TaH59zmxVkiQoeE9X8hrWZYLc`, `/api/health` → 200 database connected
- Source code confirmed: `add-selection-form.tsx` lines 512-534 — advanced panel always mounted, CSS `hidden` class toggles visibility (fix is in staging)
- T1 PASS: Partition (Category=Single, Glass Type=ID1, Thickness=12) adds successfully via "Add Component" without opening Configure — no "is required" error, component appears in Saved Components
- T2 PASS: Opening Configure after those basic fields shows U Profile auto-selected as "I LUF-01" and disabled
- T3 PASS: Door with Category=Single + Door Type=Simple Glass still fires '"Has Frame" is required.' when Add Component clicked without Configure
- Test data: two projects created (`test-hf-autoselect-staging` ID 48a10991-..., `test-hf-autoselect-staging-v2`) — both confirmed deleted (GET returns 404). No other e2e-testorg data was touched.
- Report: `.engineering/hotfix-configure-advanced-autoselect/bugs-2.md`

### 2026-10-02 · engineering:test · Round 3 (Part 2: H-2..H-5)
- Role: tester
- Verdict: **FAIL**
- Issues: 0 CRITICAL · 1 MAJOR · 0 MINOR
- Environment: branch preview `https://quotation-system-ltqi14f9y-vistra-indias-projects.vercel.app` (branch `hotfix/configure-advanced-field-autoselect` @ `3e217f0`)
- H-2 PASS: door swing lines (SVG), LH/RH labels, hinge menu right-click, LH→RH switch, double-leaf 5 lines, isDoubleLeaf=No single-leaf — all verified
- H-3 SKIP: submit-design 409 on dev preview (no formula set in e2e-testorg); `lib/summary/index.ts` handing logic verified by unit test `summary-builder.test.ts:ok10`
- H-4-esc FAIL: Escape on inline height editor clears panel selection (workspace document-level keydown handler fires); height button disappears. See bugs-3.md.
- H-4-enter/clamp/zero PASS: Enter commits, clamp to wall height works, 0 accepted
- H-5 (all 6 subtests) PASS: handles render, ArrowLeft/Right nudge, divider click doesn't change selection, widths persist after Save, 100mm min enforced, drag trades width
- REGRESSION (3 tests) PASS: panel select/deselect, right-click menu, door slider still visible
- Playwright test committed: `tests/e2e/hotfix-2026-10-01-h2-h5.spec.ts` (bb6c9e6)
- Test data: all created projects deleted by afterAll hook; DOOR ComponentType schema not modified (SA creds absent, schemaWasModified=false)
- Report: `.engineering/hotfix-configure-advanced-autoselect/bugs-3.md`

### 2026-10-02 · engineering:test · Round 4 (H-2..H-6 + configure gate)
- Role: tester
- Verdict: **FAIL**
- Issues: 0 CRITICAL · 1 MAJOR · 0 MINOR
- Environment: branch preview `https://quotation-system-qfg0gvgp5-vistra-indias-projects.vercel.app` (branch `hotfix/configure-advanced-field-autoselect` @ `12a20c1`)
- H-2 PASS: all 5 runnable sub-tests pass (SA-field sub-test skipped — no SA creds)
- H-3 SKIP: submit-design 409 on dev preview (no formula set in e2e-testorg); code + unit tests verified PASS
- H-4-esc FAIL AGAIN: fix in 12a20c1 used React's `e.stopPropagation()`, which does NOT stop the workspace's native `document.addEventListener('keydown', ...)` handler. Needs `e.nativeEvent.stopImmediatePropagation()`. (design-workspace.tsx line 184 / saved-components-rail.tsx line 419)
- H-4 enter/clamp/zero PASS
- H-5 (all 6 sub-tests) PASS
- H-6 PASS: API auth (401/403), cross-org isolation (403), uptodate shape, POST apply, page renders up-to-date message; non-DRAFT redirect and "Update configuration" button (DRAFT only) confirmed by code; wizard 3 steps confirmed by code
- Configure page "Continue to Design" disabled with 0 components: PASS
- REGRESSION (3 tests) PASS
- TypeScript: 0 errors in hotfix-2026-10-01-h2-h5.spec.ts; 'doorDiv' redeclare issue described in task brief is NOT present
- Test data: all e2e-testorg test projects deleted; 0 residual
- Report: `.engineering/hotfix-configure-advanced-autoselect/bugs-4.md`

### 2026-10-02 · engineering:test · Round 5 (narrow re-test: H-4-esc fix at 982bb0b)
- Role: tester
- Verdict: **PASS**
- Issues: 0 CRITICAL · 0 MAJOR · 0 MINOR
- Environment: branch preview `https://quotation-system-kzhdegbjw-vistra-indias-projects.vercel.app` (branch `hotfix/configure-advanced-field-autoselect` @ `982bb0b`)
- H-4-esc PASS: Escape closes the inline height editor, height unchanged, door panel stays selected, Door Height section remains visible — fix confirmed (nativeEvent.stopImmediatePropagation() prevents workspace deselect)
- H-4-enter PASS: Enter commits typed height (1800mm), displayed value updates
- REGRESSION-panel-select PASS: plain Escape with no editor open still deselects the panel (workspace handler fires normally)
- REGRESSION-door-slider PASS: slider visible when door panel selected; Door Height section intact
- All 4 tests: 4/4 passed in 28.5s, workers=1
- Test data: afterAll hook deleted all e2e-testorg test projects; confirmed clean
- No bugs file — no issues found.
