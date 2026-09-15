# Track 0 Foundation — Implementation Plan

Branch: `feature/s21-t0-foundation` (off `release/stage-21`)
Author: developer, 2026-09-15

---

## Deviations from approved stage docs

**None detected.** Every decision below follows the task specs in
`track-0-foundation.md` and the mockup exactly. Three items that could be read as
new decisions are called out explicitly and are not deviations — they are the
only sound way to implement the spec:

1. **`ConfigureSelection` type in types.ts must change from `panelId: string` to
   `panelIds: string[]`** — the mockup always uses an array (even for single-select)
   and multi-select is required by Tracks D3/D4. This breaks configure-mode.tsx and
   saved-components-rail.tsx, but T0.4 touches both files as part of the
   mutatePartition migration anyway, so the breakage is contained and resolved
   within Track 0.

2. **ConfirmDialog needs a three-button variant for T0.6** — the existing
   `components/confirm-dialog.tsx` only supports two actions. The plan extends it
   with an optional `thirdAction` prop slot rather than creating a new component,
   keeping the existing API fully backward-compatible. If the reviewer prefers a
   separate component, flag it before implementing.

3. **`SET_ROOM_NAME` action and `pendingRoomNameEdits` state added to the draft**
   (architect review fix, 2026-09-15) — Track B's S21-B2 requires room-name editing
   to route through the draft context and only persist on Save. `DraftState` gains
   `pendingRoomNameEdits: Record<string, string>` (roomId → pending label); `DraftAction`
   gains `{ type: "SET_ROOM_NAME"; roomId: string; name: string }`. The `save` function
   writes each pending room rename via `PATCH /api/v1/orgs/[orgSlug]/rooms/[id]` in
   parallel with the partition PATCH. `LOAD_PARTITION` and `MARK_SAVED` both clear
   `pendingRoomNameEdits`. A `SET_STOPS` action is also added to cover the existing
   edge-profile `assignProfile` call site being migrated away from immediate-write
   (the UI for it is removed in Track D per D-5, but the reducer must compile-clean).

---

## Tasks

### S21-0.1 · Token mapping

**Files to change:**
- `app/globals.css` — add new `@theme` tokens where the mockup `:root` has values
  that have no current equivalent
- `quotation-system-docs/design-docs/ui/token-map.md` — **new file** (docs repo),
  the authoritative mapping table

**Mapping (mockup var → app token → verdict):**

| Mockup `:root` var | Value | App `@theme` token | Verdict |
|---|---|---|---|
| `--bg` | `#F7F8EF` | `--color-bg-page` | ✅ exact match |
| `--card` | `#FBFAF5` | `--color-bg-card` | ✅ exact match |
| `--card-solid` | `#FFFFFF` | `--color-bg-white` | ✅ exact match |
| `--border` | `#E0E2D7` | `--color-border` | ✅ exact match |
| `--ink` | `#1B281E` | `--color-text-heading` | ✅ exact match |
| `--body-ink` | `#3A4038` | `--color-text-body` | ✅ exact match |
| `--muted` | `#5C665C` | `--color-text-muted` | ✅ exact match |
| `--placeholder` | `#8A8177` | `--color-text-placeholder` | ✅ exact match |
| `--accent` | `#4E7F58` | `--color-primary` | ✅ exact match |
| `--accent-dark` | `#3E6647` | `--color-primary-dark` | ✅ exact match |
| `--accent-bg` | `#ECF0ED` | `--color-primary-softer` | ✅ exact match |
| `--accent-border` | `#CBDFCD` | `--color-primary-soft` | ✅ exact match |
| `--on-accent` | `#FFFFFF` | `--color-text-on-primary` | ✅ exact match |
| `--done-bg` | `#D4F1D4` | `--color-status-paid-bg` | ✅ exact match |
| `--done-text` | `#2E6B34` | `--color-status-paid-text` | ✅ exact match |
| `--hover-bg` | `#EFF2E8` | ❌ no token | **ADD** `--color-bg-hover: #EFF2E8` |
| `--danger` | `#B3261E` | `--color-status-failed-text` | ✅ exact match |
| `--danger-bg` | `#FDECEA` | ❌ no token | **ADD** `--color-danger-bg: #FDECEA` |
| `--danger-border` | `#E3B3AE` | ❌ no token | **ADD** `--color-danger-border: #E3B3AE` |
| `--border-strong` | `#C7CCB6` | ❌ no token | **ADD** `--color-border-strong: #C7CCB6` |
| `--panel-label` | `#B8863D` | ❌ no token | **ADD** `--color-panel-label: #B8863D` |

No raw hex/px/radius/shadow literal used in the mockup conflicts with an existing
app token value. The 5 new tokens follow the existing `--color-*` naming convention.
No value conflicts found; no architect escalation needed.

**Verify:** `npm run lint` + `npx tsc --noEmit` locally. Visual swatch verification
against the mockup's rendered colors on the pushed branch's Vercel preview.

---

### S21-0.2 · Trim wizard-layout padding

**Files to change:**
- `app/[orgSlug]/projects/[projectId]/layout.tsx` — change `<div className="py-8">`
  to `<div>` (remove `py-8` entirely from the shared wrapper)
- `app/[orgSlug]/projects/[projectId]/page.tsx` — add `py-8` to its outermost `<div>`
- `app/[orgSlug]/projects/[projectId]/edit/page.tsx` — add `py-8` to outermost `<div>`
- `app/[orgSlug]/projects/[projectId]/configuration/page.tsx` — add `py-8` to outermost `<div>`
- `app/[orgSlug]/projects/[projectId]/summary/page.tsx` — add `py-8` to outermost `<div>`
- `app/[orgSlug]/projects/[projectId]/quotation/page.tsx` — add `py-8` to outermost `<div>`
- `app/[orgSlug]/projects/[projectId]/design/page.tsx` — **no `py-8` added** (Design
  is the beneficiary; it handles its own spacing)

**Verify:** Push branch → Vercel preview → eyeball all 5 non-Design wizard pages
vs. before (no layout shift), and confirm Design's workspace runs flush to the
wizard breadcrumb with no inherited vertical gutter.

---

### S21-0.3 · Three-column CSS grid shell

**Files to change:**
- `app/[orgSlug]/projects/[projectId]/design/design-workspace.tsx` — replace the
  outermost `<div className="flex flex-1 gap-4 overflow-hidden p-4">` and its three
  fixed-width aside/div children with a CSS grid using the mockup's exact
  `minmax()` ranges. Existing child components are stubbed in unchanged.
- `app/[orgSlug]/projects/[projectId]/design/page.tsx` — ensure the page's return
  wrapper (currently passes straight to DesignWorkspace) lets the workspace grow to
  `h-full`/`flex-1` so the grid has room to stretch.

**Grid contract (published for Tracks A–D):**
```
grid-template-columns: minmax(210px,250px) minmax(360px,1fr) minmax(260px,300px)
gap: 18px; padding: 18px 24px; max-width: 1480px; margin: 0 auto;
@media (max-width: 1400px): minmax(196px,226px) 1fr minmax(240px,270px); gap:14px; padding:14px 18px
@media (max-width: 1180px): 1fr (stacked)
```

Named regions (Tailwind `col-start` / class convention, not CSS `grid-area`, to
avoid inline CSS):
- Column 1: `col-start-1` — Track A's left rail (floor bar + room list)
- Column 2: `col-start-2` — Tracks B/D's center card (layout/configure/empty)
- Column 3: `col-start-3` — Track C's right rail (saved components)

No fixed `w-64`/`w-72` classes remain after this change. Breakpoints use Tailwind's
`max-lg` / custom arbitrary value: `max-[1400px]` and `max-[1180px]`.

**Reuse:** The existing `UnitProvider`, `FloorBar`, `RoomList`, `RoomFloorPlan`,
`ConfigureMode`, `SavedComponentsRail` components all stay mounted — just
repositioned into the new grid cells.

**Verify:** Push to Vercel preview → test at 1920/1400/1280/1180/1024px viewport
widths (browser DevTools responsive mode) — columns should reflow exactly as in
the mockup.

---

### S21-0.4 · Draft-state reducer/context (HARD GATE, highest risk)

**Files to change/create:**
- `app/[orgSlug]/projects/[projectId]/design/design-draft-context.tsx` — **new file**
- `app/[orgSlug]/projects/[projectId]/design/types.ts` — update `ConfigureSelection`
- `app/[orgSlug]/projects/[projectId]/design/design-workspace.tsx` — mount
  `DraftProvider`, wire Save/Discard/back-button, remove `mutatePartition`
- `app/[orgSlug]/projects/[projectId]/design/configure-mode.tsx` — remove `mutate`
  prop, wire `useDraftContext()`
- `app/[orgSlug]/projects/[projectId]/design/saved-components-rail.tsx` — remove
  `mutate` prop, wire `useDraftContext()`

**Reuse:** `lib/` API route `/api/v1/orgs/${orgSlug}/partitions/${id}` (GET + PATCH)
via existing fetch pattern. `configure-constants.ts` for `DEFAULT_PANEL_WIDTH_MM`
and `MIN_SPLIT_WIDTH_MM`.

---

#### Draft state shape

```typescript
// design-draft-context.tsx

export interface DraftState {
  partitionId: string | null;
  draft: PartitionRow | null;     // local working copy; mutated by reducer, not yet saved
  server: PartitionRow | null;    // snapshot of last-saved state; restored on Discard
  isDirty: boolean;               // true after any mutating action; false after LOAD or MARK_SAVED
  selection: DraftSelection;
  /** Room renames deferred until Save. roomId → pending label.
   * Cleared by LOAD_PARTITION and MARK_SAVED. Set by SET_ROOM_NAME.
   * Track B's S21-B2 dispatches SET_ROOM_NAME from room-name-input.tsx. */
  pendingRoomNameEdits: Record<string, string>;
}

// Replaces ConfigureSelection in types.ts (breaking change — contained within T0.4)
export type DraftSelection =
  | { type: "panel"; panelIds: string[] }  // always an array; single-select uses length-1 array
  | { type: "edge"; side: EdgeSide }
  | null;
```

---

#### Action union (FROZEN / append-only after Track 0 ships)

```typescript
export type DraftAction =
  // ── Lifecycle ────────────────────────────────────────────────────────────
  // LOAD_PARTITION: replaces both draft and server snapshot, clears isDirty.
  // Call after a fresh GET /partitions/[id].
  | { type: "LOAD_PARTITION"; partition: PartitionRow }
  // MARK_SAVED: after a successful PATCH; updates server snapshot, clears isDirty.
  | { type: "MARK_SAVED"; partition: PartitionRow }

  // ── Selection ────────────────────────────────────────────────────────────
  // SET_SELECTION: replace selection entirely (pass null to deselect).
  | { type: "SET_SELECTION"; selection: DraftSelection }

  // ── Panel structural mutations ────────────────────────────────────────────
  // ADD_PANEL: append a new glass panel at DEFAULT_PANEL_WIDTH_MM.
  | { type: "ADD_PANEL" }
  // REMOVE_PANELS: caller ensures panelIds.length < total panels.
  | { type: "REMOVE_PANELS"; panelIds: string[] }
  // SPLIT_PANEL: caller ensures panel widthMm >= MIN_SPLIT_WIDTH_MM.
  | { type: "SPLIT_PANEL"; panelId: string }
  // MAKE_EQUAL_WIDTH: floor(total/n) per panel; last panel absorbs remainder.
  | { type: "MAKE_EQUAL_WIDTH" }
  // UNITE_PANELS: caller ensures panelIds are contiguous; merged width = sum.
  | { type: "UNITE_PANELS"; panelIds: string[] }

  // ── Panel/partition dimension mutations ──────────────────────────────────
  // SET_PANEL_WIDTH: set exact widthMm on one or more panels (bulk-aware).
  | { type: "SET_PANEL_WIDTH"; panelIds: string[]; widthMm: number }
  // SET_PARTITION_WIDTH: proportional rescale all panels; clamps each ≥ min.
  | { type: "SET_PARTITION_WIDTH"; widthMm: number }
  // SET_PARTITION_HEIGHT: update heightMm; clamp each door.heightMm ≤ heightMm.
  | { type: "SET_PARTITION_HEIGHT"; heightMm: number }
  // SET_PARTITION_LABEL: rename.
  | { type: "SET_PARTITION_LABEL"; label: string }

  // ── Glass / door mutations (Track C/D UI dispatches these) ───────────────
  // SET_GLASS: set selectionId on targeted panels (null = clear glass).
  | { type: "SET_GLASS"; panelIds: string[]; selectionId: string | null }
  // TOGGLE_DOOR: if panel has a door, remove it; else add with selectionId.
  | { type: "TOGGLE_DOOR"; panelId: string; selectionId: string }
  // SET_DOOR_HEIGHT: update door.heightMm; clamped to partition.heightMm.
  | { type: "SET_DOOR_HEIGHT"; panelId: string; heightMm: number }
  // SET_DOOR_HINGE: switch hinging on an existing door.
  | { type: "SET_DOOR_HINGE"; panelId: string; hinging: "left" | "right" }
  // SET_ROOM_NAME: deferred room rename; only written to the server on Save.
  // isDirty is set true. Track B's S21-B2 dispatches this from room-name-input.tsx.
  | { type: "SET_ROOM_NAME"; roomId: string; name: string }
  // SET_STOPS: update one edge-profile stop in design.stops. Used by the
  // existing saved-components-rail.tsx assignProfile call site during the
  // immediate-write migration (D-5 removes the UI for this in Track D).
  | { type: "SET_STOPS"; side: EdgeSide; selectionId: string | null }
  ;
```

---

#### Context API surface (what components consume)

```typescript
type SaveResult =
  | { ok: true; partition: PartitionRow; updatedRooms: RoomRow[] }
  | { ok: false; error: string };

interface DraftContextValue {
  state: DraftState;
  dispatch: React.Dispatch<DraftAction>;
  /** One PATCH of the partition + PATCHes of all pendingRoomNameEdits (parallel).
   * Returns updatedRooms so design-workspace.tsx can update its floors state. */
  save: (orgSlug: string, isSubdomain: boolean) => Promise<SaveResult>;
  /** Reload partition fresh from server → dispatches LOAD_PARTITION (clears
   * pendingRoomNameEdits too — room renames are discarded with the draft). */
  discard: (orgSlug: string, isSubdomain: boolean) => Promise<void>;
}

export function useDraftContext(): DraftContextValue;
export function DraftProvider({ children }: { children: React.ReactNode }): JSX.Element;
```

`DraftProvider` is mounted once inside `DesignWorkspace`'s return (alongside the
existing `UnitProvider`). It does not own `orgSlug` or `isSubdomain` — those are
passed as arguments to `save`/`discard` so the context itself is stateless w.r.t.
routing.

**`enterConfigureMode` flow:** DesignWorkspace calls
`dispatch({ type: "LOAD_PARTITION", partition })` once the fetch resolves (replaces
the existing `setActivePartition`). The `state.draft` drives the UI; `state.server`
is the snapshot for Discard.

**Save flow:** `save(orgSlug, isSubdomain)` PATCHes
`{ label: draft.label, heightMm: draft.heightMm, design: draft.design }` in one
request (the v1 `updatePartition` path). On success dispatches `MARK_SAVED`.

**Discard flow:** `discard(orgSlug, isSubdomain)` GETs the partition fresh and
dispatches `LOAD_PARTITION`. No separate state-clearing needed.

---

#### "Append-only compatible" contract — what it means for Tracks A–D devs

1. `DraftAction` is the complete discriminated union. **Do not rename, remove, or
   reorder existing variants.** You may add new variants at the bottom of the union.
2. The reducer `switch` has a `case` for every defined action type. To add a new
   action: (a) add its type to the `DraftAction` union, (b) add its `case` in the
   reducer, (c) dispatch it from your UI component. None of these edits touch
   `design-workspace.tsx`.
3. `design-workspace.tsx` only calls `useDraftContext()` for
   `state.isDirty` / `save` / `discard` / the back-button guard. It never switches
   on action types. It is **frozen** after Track 0 merges.
4. Tracks that need the draft value read `state.draft` directly from the hook.
   Tracks that mutate the draft call `dispatch(...)`. The context API surface is
   stable.

**Sum-invariant note:** `sum(draft.design.panels[].widthMm) === draft.widthMm` is
maintained by the reducer for every mutating action except `ADD_PANEL`. `ADD_PANEL`
increases the logical total by `DEFAULT_PANEL_WIDTH_MM` and does NOT update
`draft.widthMm` client-side — confirmed correct: `lib/data/partitions.ts` line 284
derives `data.widthMm = nextDesign.panels!.reduce((sum, p) => sum + p.widthMm, 0)`
server-side whenever `patch.design.panels` is present, so the sum-invariant is
enforced at the server on every Save, never trusted from the client. This
correctness is documented as a comment on the ADD_PANEL reducer case. The stage's
highest-risk invariant (profile.md) must be verified explicitly during review for
`SET_PARTITION_WIDTH`, `MAKE_EQUAL_WIDTH`, `UNITE_PANELS`, and `SET_PANEL_WIDTH` (bulk).

**Single-editor assumption:** Concurrent multi-user editing of the same partition is
not handled. Last Save wins. This is explicitly documented in the context's JSDoc,
not silently assumed.

---

**Verify:** Push to Vercel preview → open a partition in Configure mode → make
changes → confirm no network PATCH fires until Save is pressed (DevTools Network
tab) → Save → reload → changes persist → Discard → changes drop. `isDirty` truth:
false on load, true after any mutation, false after Save/Discard.

---

### S21-0.5 · ContextMenu primitive

**Files to create:**
- `components/context-menu.tsx` — **new file**

**API:**
```typescript
interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  disabledTitle?: string;
}

interface ContextMenuDivider { type: "divider" }

interface ContextMenuCustomSlot {
  type: "custom";
  content: React.ReactNode;  // for the Apply Width row + standard-width buttons
}

type ContextMenuEntry = ContextMenuItem | ContextMenuDivider | ContextMenuCustomSlot;

interface ContextMenuProps {
  anchorX: number;           // clientX from contextmenu event
  anchorY: number;           // clientY from contextmenu event
  items: ContextMenuEntry[];
  onClose: () => void;
}

export function ContextMenu(props: ContextMenuProps): JSX.Element | null;
```

**Behaviour:**
- Viewport-aware: `Math.min(anchorX, window.innerWidth - menuWidth - 8)` /
  `Math.min(anchorY, window.innerHeight - menuMaxHeight)` — mirrors mockup lines
  1775-1777.
- Dismiss on: `Escape` keydown, outside click (`document` listener via `useEffect`),
  scroll.
- Native context menu suppressed only for the trigger element (the trigger calls
  `e.preventDefault()` on its `onContextMenu` event before opening the menu — the
  ContextMenu component itself does not suppress globally).
- Custom slot: an embedded `<input type="number">` inside a `ContextMenuCustomSlot`
  fires `onClose` only on blur or Escape, never on Enter (so the Apply Width input
  works — mockup lines 1833-1856).
- Keyboard focus: first non-disabled item receives focus on open; Tab cycles through
  items; Escape closes.

**Reuse:** None (first right-click menu in the app). Pattern follows the existing
`ConfirmDialog` component structure (controlled, prop-driven, `useEffect` for
dismiss).

**Visual:** Matches mockup lines 431-462 using the new tokens from S21-0.1
(`--color-border-strong` for the menu border, `--color-primary-softer` for hover).

**Verify:** `npm run lint` + `npx tsc --noEmit` locally. Functional verification
on Vercel preview: open, dismiss via Escape/outside click/scroll; custom input
accepts Enter without closing; disabled items show title and are non-interactive;
menu stays fully on-screen near viewport edges.

---

### S21-0.6 · Unsaved-changes modal

**Files to change:**
- `components/confirm-dialog.tsx` — extend with optional `thirdAction` prop:
  ```typescript
  /** Optional third action button (rendered below the primary, above cancel).
   * Used by the unsaved-changes modal for a three-choice prompt. When omitted
   * the dialog behaves exactly as before (backward-compatible). */
  thirdAction?: { label: string; onClick: () => void; variant: "danger" | "default" }
  ```
- `app/[orgSlug]/projects/[projectId]/design/design-workspace.tsx` — add modal
  wiring at the mount point (show/hide state, the three callbacks)

**Behaviour (mirrors mockup lines 1916-1955):**
- Back button (currently `backFromConfigureMode`) checks `state.isDirty` from
  `useDraftContext()`.
- If clean: navigate immediately (existing behaviour preserved).
- If dirty: show the extended ConfirmDialog with:
  - Primary: "Save & Go Back" → `await save(orgSlug, isSubdomain)` then navigate
  - Third (danger): "Discard Changes" → `await discard(orgSlug, isSubdomain)` then navigate
  - Cancel: close modal, stay on page
- **Escape is a no-op for this modal specifically:** the ConfirmDialog's `Escape` handler
  is disabled when the `thirdAction` prop is present (or a new `disableEscapeClose` prop
  is added). The global Escape handler in design-workspace.tsx checks for modal presence
  first — if the modal is open, Escape is swallowed at the modal level, not propagated to
  clear panel selection or dismiss context menus.
- Clicking the overlay does NOT discard — the overlay's `onClick` calls the Cancel path,
  not the Discard path (same as the mockup: `unsavedChangesModal = null; renderAll()`).

**Note on `thirdAction` vs. new component:** The three-button modal is the only
place this is needed in Stage 21's scope. Extending ConfirmDialog with an optional
prop is the minimal-surface-area choice; it stays backward-compatible. If the
reviewer prefers a dedicated `UnsavedChangesDialog` component, that's a zero-risk
swap — flag during review, not a blocker.

**Verify:** Push to Vercel preview → open Configure mode → make a change →
click Back → modal appears → test each of the 3 paths → Escape does nothing → clicking
overlay does not discard.

---

## Execution order within Track 0

```
0.1 (token mapping)  ─┬─> 0.3 (grid shell, depends on tokens)
0.2 (padding trim)   ─┘
0.4 (draft state)    ─────> 0.6 (unsaved modal, depends on 0.4)
0.5 (ContextMenu)    (independent)
```

0.1 + 0.2 + 0.4 + 0.5 can be implemented in a single pass (no ordering constraint
among them). 0.3 follows 0.1. 0.6 follows 0.4. Likely order: 0.1 → 0.2 → 0.4 →
0.5 → 0.3 → 0.6 (grouped by risk: tokens and layout first, then the reducer, then
the simpler primitives).

---

## Verification summary

All functional verification (no network write before Save, Save/Discard round-trip,
modal behavior, grid breakpoints) runs against the pushed branch's own Vercel
preview per the HARD RULE in profile.md. `npm run lint` + `npx tsc --noEmit` run
locally before each push for fast feedback.
