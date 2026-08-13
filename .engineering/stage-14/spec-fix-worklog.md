# Spec-fix worklog — feature/fix-stale-spec-locators

**Agent:** developer  
**Branch:** `feature/fix-stale-spec-locators`  
**Source:** regression report `.engineering/stage-14/regression-1.md`  
**Started:** 2026-08-13  

---

## Plan summary

Three classes of breakage, 8 files:

| Class | Files |
|---|---|
| 1. `destinationCountry` removed + `currency` → `<select>` | `stage5.spec.ts`, `stage6.spec.ts`, `stage7.spec.ts`, `stage12.spec.ts`, `stage13.spec.ts` |
| 2. "Actions" text link → icon-only Edit link (`aria-label="Edit"`) | `admin-stage4.spec.ts`, `login.spec.ts`, `subdomain-navigation.spec.ts` |
| 3. `window.confirm` → ConfirmDialog | `stage13.spec.ts` |

Plus: `stage6.spec.ts` Admin button strict-mode (MINOR-1: add `.first()`).

**Key facts from source files:**
- Edit link in users page: `aria-label={t("editAction")}` where `users.editAction = "Edit"` → aria-label = **"Edit"**
- Delete button in users page: `aria-label={\`Delete user ${username}\`}` → includes username
- Edit link in external-companies page: `aria-label={t("editAction")}` where `externalCompanies.editAction = "Edit"` → same "Edit"
- ConfirmDialog for companies: `confirmLabel="Delete"` → confirm button text = "Delete"
- Create inquiry form new required fields (Stage 14 Batch B): `projectLocation`, `endClientName`, `endClientPhone`, `endClientEmail`, `endClientAddressLine1`, `endClientAddressLine2`, `endClientCity`, `endClientState`
- Create project form new required fields (Stage 14 Batch C): same set
- `submissionDate` pre-filled via `defaultValue={todayLocal}` — no fill needed
- `currency` select options: INR / AED / USD (SAR, KSA not valid)

---

## Progress

### Class 2 — "Actions" link fixes

- [ ] `admin-stage4.spec.ts`
- [ ] `login.spec.ts`
- [ ] `subdomain-navigation.spec.ts`

### Class 3 — ConfirmDialog fix

- [ ] `stage13.spec.ts` (delete company test)

### Class 1 + MINOR-1 — Form field fixes

- [ ] `stage5.spec.ts`
- [ ] `stage6.spec.ts`
- [ ] `stage7.spec.ts`
- [ ] `stage12.spec.ts`
- [ ] `stage13.spec.ts` (inquiry/project create tests)

---

## Verification runs (to be appended)

(pending)
