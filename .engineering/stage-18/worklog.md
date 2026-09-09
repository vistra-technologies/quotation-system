# Stage 18 — Worklog

**Stage target:** [`quotation-system-docs/development-cycles/stage-18.md`](../../../quotation-system-docs/development-cycles/stage-18.md) — Rooms: `Floor → Room → Partition` restructure + room topology (ordered JSONB `sides`) for BOQ.
**Tracker row:** [`development-cycles/README.md`](../../../quotation-system-docs/development-cycles/README.md)
**Stage branch:** `release/stage-18` (cut from `master` @ `5200d7e`, 2026-09-08).

---

## Work items

_(to be filled in once the developer's plan proposes a breakdown — see stage doc scope items 1-6)_

---

## Activity log

- **2026-09-08 — implement orchestrator**: oriented to workspace, confirmed Stage 18 is the approved
  (📝 Spec'd) target with no `.engineering/stage-18/` seeded by stage-prep. Cut `release/stage-18` off
  up-to-date `master` (`5200d7e`). Scaffolding `profile.md` next via a dispatched developer agent
  (schema-migration stage — needs fresh discovery of `Floor`/`Partition` current shape, not reusable
  from Stage 17's profile).

- **2026-09-08 — profile discovery (developer agent)**: `profile.md` written. Notable findings:
  (1) **`by-page.sql` was NOT actually updated for Stage 18** despite the stage doc's scope-item-5 claim
  that docs are "already updated ahead of implementation" — grepped for Room/Stage 18, zero matches;
  treat it as not-yet-started work for the implementing developer. `04-data-model.md` and
  `08-decisions-and-changelog.md` are genuinely updated; `07-roadmap-open-questions.md` has one stale
  `RoomSide` reference left over from before the same-day JSONB-collapse decision (minor, non-blocking).
  (2) **The unreviewed mockup (`design-step-poc.html`) does NOT contradict** the "four plain sides,
  converted one at a time" interaction from scope item 3 — but its `wallSlots` data model is a fixed
  top/left/right/bottom object with no ordering/adjacency concept and no PLAIN-side `label`/`lengthMm`,
  so it can't be copied structurally, only used as an interaction-pattern reference. Worth a quick
  confirmation before the design-page rework batch, not a blocker. (3) **No Stage-8 Floor/Partition API
  route exists** — the design page has always bypassed the API layer via an `eslint-disable
  no-restricted-imports` deferral; this stage is the intended end of that deferral for the Room slice.
  (4) `npm run build` already runs `prisma migrate deploy` unconditionally on every branch's build, so
  the clean-break migration will wipe existing dev-DB `Floor`/`Partition` rows on the very first
  `feature/*` push, not just at the `staging`→`master` gate — expected/authorized but worth knowing.
  Full detail in `profile.md`.

- **2026-09-08 — plan (developer agent)**: `plan.md` written. Flagged 6 items at the top for the
  deviation gate — 3 pre-authorized "developer's call" resolutions (below-3-sides validation only when
  closed; convert-back deletes the Partition; side ids always server-minted), the mockup-vs-`sides[]`
  resolution (build to stage doc's actual shape, mock is interaction-pattern reference only), a proposed
  small PLAIN-side label/length inline editor (flagged as a minor addition beyond literal scope), and
  confirmation that `by-page.sql`/the stale `07-roadmap-open-questions.md` wording are in scope this
  stage. Proposed a 4-item breakdown (schema+migration → API+DAL → design-page rework, tests) with a
  recommendation to run mostly serial (schema is a hard sequencing gate; design-page needs Item 2's
  route contracts to code against) rather than a full parallel dispatch.

- **2026-09-08 — GATE A (human)**: two decisions taken. (1) **Cut** the proposed PLAIN-side label/length
  inline editor — `label`/`lengthMm` on PLAIN sides stay API-only this stage, no design-page UI; `plan.md`
  updated. (2) **Serial, one developer**, standard dev⇄reviewer loop for all 4 items in order — no
  parallel worktrees this stage; `plan.md` updated. Proceeding to Step 4 (dev⇄reviewer loop), Item 1
  (schema + migration) first.

- **2026-09-08 — implementation plan (developer agent)**: `plan.md` written. Resolved the 3 stage-doc
  open items (developer's call, pre-authorized): below-3-sides validation only enforced when
  `isClosed: true`; convert-back **deletes** the `Partition` row (per stage doc's own recommendation);
  side `id`s are always server-minted/re-derived on every `sides` PATCH, never trusted from client. Mockup
  gap resolved per profile.md's recommendation: build to the stage doc's actual `sides[]` shape, mock is
  interaction-pattern reference only (list-based UI, not a 4-bar N/S/E/W square). Also flagged one small
  addition beyond the literal mock — a minimal inline label/length editor for PLAIN sides, since the
  stage doc's own `sides[]` shape has those fields and nothing excludes editing them. `by-page.sql` +
  the stale `07-roadmap-open-questions.md` `RoomSide` wording are confirmed in-scope for this plan's
  Item 2. Proposed a 4-item breakdown (schema/migration → API+DAL → design-page rework → tests) but
  recommended **mostly-serial execution**, not full parallel dispatch — Item 1 gates everything, and
  Item 3 needs Item 2's route contracts before it can usefully start; only Items 3+4 have a real
  parallel window, and even that's conditional. No BLOCKED items. Full detail in `plan.md`.

- **2026-09-09 — Item 1: schema + migration (developer agent)**: `prisma/schema.prisma` — added `Room`
  model (`id`, `organizationId`, `floorId` FK→Floor cascade, `label`, `orderIndex`, `isClosed` default
  `true`, `sides` JSONB default `[]`, timestamps, `@@unique([floorId, label])`), reverse relations
  `Floor.rooms`/`Organization.rooms`. `Partition`: dropped `floorId`/`location`, added `roomId` (FK→Room
  cascade) + `label` (String); everything else unchanged. Migration
  `prisma/migrations/20260909000001_rooms_restructure/` applied against the shared Neon dev branch.
  **Hand-authored, not machine-generated via `prisma migrate dev`**: hit a pre-existing, unrelated
  checksum drift on migration `20260811192114_add_company_country_currency` (its committed
  `migration.sql` sha256 doesn't match the checksum recorded in `_prisma_migrations` at apply time — not
  a line-ending issue, verified both CRLF and LF-normalized bytes against the stored checksum, neither
  matched) that makes `prisma migrate dev`'s shadow-database step refuse to run and offer only `migrate
  reset` (full DB wipe, out of scope/too destructive to reach for). Worked around by generating the SQL
  diff via `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
  (talks to the real DB, no shadow database involved), hand-assembling the migration folder with the
  clean-break `DELETE FROM "Partition"; DELETE FROM "Floor";` prepended before the column changes (per
  profile.md's exact ordering rationale), and applying with `prisma migrate deploy` (also shadow-db-free).
  Confirmed applied cleanly: `prisma migrate status` → "Database schema is up to date!", 20 migrations
  found. The unrelated drifted migration file was left byte-for-byte as it was in git (confirmed via
  `git diff`, empty) — not part of this change, flagging for the human/architect since it will keep
  blocking any future `prisma migrate dev` use in this repo until someone reconciles that one migration's
  checksum or resets/repairs `_prisma_migrations`. `npx prisma generate` regenerated
  `app/generated/prisma/` — spot-checked `roomId` appears in `models/Partition.ts` and the client
  internals. `npm run lint` — 0 errors (5 pre-existing unrelated warnings in `tests/e2e/**`).
  `npx tsc --noEmit` — exactly 3 errors, exactly the expected files per profile.md: `lib/data/
  partitions.ts` (2 errors — `floorId` not in `PartitionWhereInput`/`PartitionUncheckedCreateInput`) and
  `app/[orgSlug]/projects/[projectId]/design/page.tsx` (1 error — `.location` no longer exists on
  `Partition`). `design/add-wall/actions.ts` compiled clean at this pass (it types against the
  hand-written `CreatePartitionInput` interface in `partitions.ts`, not the Prisma type directly, so its
  error will surface once Item 2 rewrites that interface) — left untouched, Item 2/4's job. Committed on
  `feature/rooms-schema-migration` (schema.prisma + new migration folder + this worklog entry) and
  pushed. Note per profile.md: this migration is destructive to the shared dev DB's existing
  `Floor`/`Partition` rows — already wiped by the `migrate deploy` run above (expected/authorized, no
  real data existed).

- **2026-09-09 — Item 1 review (reviewer agent)**: **APPROVE-WITH-NITS** on
  `feature/rooms-schema-migration` @ `de04a76`. 0 CRITICAL · 1 IMPORTANT (follow-up, not a change to this
  diff) · 1 IMPORTANT-informational (sequencing) · 3 MINOR · 1 repo-infra note. Schema verified
  field-for-field against the stage doc; migration SQL and its delete ordering confirmed correct and
  exactly as authorized (the `DELETE FROM "Floor"` is spec-mandated, not gratuitous); `lint` clean and
  `tsc` errors confirmed to be exactly the 3 expected Item 2/3 files; scope clean. Carry-forwards: add
  `tx.room.deleteMany` to `lib/data/superadmin/orgs.ts`'s org hard-delete cascade in Item 2, and note
  this branch cannot produce a READY Vercel preview on its own (TS errors fail `next build`; the
  migration still applies beforehand). Details: `review-item1.md`.

- **2026-09-09 — Item 2: API layer + DAL (developer agent)**: on `feature/rooms-api-dal` @ `8475260`
  (pushed). Plan: `.engineering/stage-18/plan-item2.md`.
  - **`lib/data/rooms.ts`** (new) — session-first-arg DAL mirroring `lib/data/selections.ts`:
    `listRoomsByFloor`, `getRoomById`, `createRoom` (MAX+1 `orderIndex` within floor, writes the 4-side
    PLAIN `turnDegrees: 90` rectangle default, `isClosed: true`), `renameRoom`, `reorderRooms`
    (all-or-nothing, rejects any `orderedRoomIds` set that isn't exactly the floor's current rooms),
    `deleteRoom` (relies on FK cascade). **`replaceSides`** is the single function that owns all `sides`
    writes, in one `prisma.$transaction`:
    - **Invariant 1 (no duplicate `partitionId`)** — `Set`-based check over the incoming array before any
      writes (`rooms.ts` ~L334-344).
    - **Invariant 2 (`Partition.roomId` agreement)** — enforced by construction: a kept PARTITION element
      is re-verified via `tx.partition.findFirst({ id, organizationId, roomId })` (~L372-385) before being
      kept; a new convert creates the Partition with `roomId` = this room in the same tx
      (`createPartitionInTx`); any previous PARTITION side no longer present anywhere in the new array
      (removed outright, not converted back) has its Partition row explicitly deleted (~L457-474) so no
      orphan is left agreeing with a room that no longer references it.
    - **Invariant 3 (`lengthMm` only on PLAIN)** — enforced by the type system: `PartitionSide`'s
      `lengthMm` is typed `null` and never set from user input; only `PlainSide` accepts a numeric value.
    - **Below-3-sides only when closed** — `willBeClosed && newSides.length < 3` check (~L328-332), per
      plan flag 1.
    - **Convert-back deletes** — a PLAIN element at the same array position as a previous PARTITION
      element triggers `tx.partition.delete` before rewriting the element to `{kind: PLAIN, partitionId:
      null, ...}` (~L419-433), per plan flag 2.
    - **Server-minted ids** — every element in `finalSides` gets either the previous side's id (kept
      PARTITION matched by `partitionId`, or PLAIN matched positionally to a previous PLAIN) or a fresh
      `crypto.randomUUID()` (new convert, convert-back, or a genuinely new position) — never trusts a
      client-supplied id, per plan flag 3.
  - **`lib/data/partitions.ts`** (rewrite) — `CreatePartitionInput.roomId`/`.label` replace
    `.floorId`/`.location`; `listPartitionsByRoom(roomId, organizationId)` replaces
    `listPartitionsByFloor`; the MAX+1 `partitionNumber` logic is factored into an exported
    `createPartitionInTx(tx, input)` so `rooms.ts`'s `replaceSides` can call it inside its own already-open
    transaction (Prisma doesn't support nested `$transaction`); `createPartition()` is now a thin wrapper
    that opens its own transaction around the same helper, preserving its existing `SEQUENCE_CONFLICT`
    error-mapping behavior for any future standalone caller.
  - **New routes** under `app/api/v1/orgs/[orgSlug]/rooms/`: `route.ts` (GET `?floorId=`, POST
    `{floorId,label}`, PATCH `{floorId,orderedRoomIds}` for reorder — reorder lives on the collection
    route since it's a whole-floor operation, not single-resource), `[id]/route.ts` (PATCH `{label}`
    rename, DELETE), `[id]/sides/route.ts` (PATCH `{sides,isClosed?}` → `replaceSides`, maps
    `InvalidSidesError` to `apiBadRequest`). All follow `selections/route.ts`'s
    `getApiSession`/`ApiAuthError`/`apiUnauthorized`/`apiForbidden`/`apiNotFound`/`apiBadRequest`/
    `dynamic = "force-dynamic"` structure exactly.
  - **`lib/data/superadmin/orgs.ts`** — added `await tx.room.deleteMany({ where: { organizationId: orgId
    } })` between the `partition` and `floor` cascade steps (renumbered the trailing comments 3→16); the
    carried-forward Item 1 review nit. Confirmed: `by-page.sql`'s matching cascade section updated with the
    same `DELETE FROM "Room"` step and renumbering.
  - **Docs sync**: `quotation-system-docs/design-docs/sql-queries/by-page.sql` — new "Stage 18 — Rooms"
    heading with raw SQL for every `prisma.room.*`/`prisma.partition.*` call added/changed this item,
    including the whole-array JSONB `sides` write as a plain `UPDATE ... SET "sides" = :sidesJson::jsonb`
    (per the stage doc's explicit instruction to write these out, not placeholder). Also updated the
    existing SuperAdmin hard-delete cascade SQL section with the new `Room` step + renumbering.
    `quotation-system-docs/design-docs/07-roadmap-open-questions.md` — fixed the stale `RoomSide`'s
    ordered chain" wording to `Room.sides`'s ordered array". **Note:** the docs repo already had several
    other files (`04-data-model.md`, `08-decisions-and-changelog.md`, mockup, `README.md`) modified-but-
    uncommitted in the working tree before I started (pre-existing from earlier stage-prep/Item-1 work,
    not mine) — I did not commit anything in `quotation-system-docs/` since no prior item did either and
    I wasn't asked to; my two file edits sit uncommitted alongside that pre-existing stack. Flagging so
    whoever does commit the docs repo for this stage includes my changes too.
  - **Verify**: `npm run lint` — 0 errors, same 5 pre-existing unrelated `tests/e2e/**` warnings.
    `npx tsc --noEmit` — exactly 3 errors remaining, all in Item-3 scope: `app/[orgSlug]/projects/
    [projectId]/design/add-wall/actions.ts:86` (`floorId` not in `CreatePartitionInput`) and
    `app/[orgSlug]/projects/[projectId]/design/page.tsx:8,91` (`listPartitionsByFloor` no longer exported;
    implicit-any on `partition` param) — confirmed nothing else regressed. Per Item 1's precedent, this
    branch still cannot produce a `READY` Vercel preview on its own (`next build` fails on those 3 TS
    errors) — not required for this item; Item 3 closes it out. Committed `8475260` and pushed to
    `feature/rooms-api-dal`.
  - No BLOCKED items; no new deviations beyond the 3 already-resolved plan flags.

- **2026-09-09 · reviewer · Item 2 (API layer + DAL for `Room`) — verdict: CHANGES-NEEDED.**
  1 CRITICAL, 1 IMPORTANT, 6 MINOR. Verified against `8475260`: lint clean, `tsc` shows exactly the 3
  expected Item-3 errors, transactionality/tenancy/route conventions/`createPartitionInTx` dedup/
  SuperAdmin cascade position/`by-page.sql` sync all confirmed correct. CRITICAL is the positional
  convert-back delete in `replaceSides` breaking any reorder involving a PARTITION side. Full report:
  `.engineering/stage-18/review-item2.md`.

- **2026-09-09 — Item 2 review fixes (developer agent)**: on `feature/rooms-api-dal` @ `c6176e8`
  (pushed), fixing `review-item2.md`'s CRITICAL, IMPORTANT, and MINOR 3.
  - **CRITICAL 1 fixed** (`lib/data/rooms.ts` `replaceSides`) — removed the positional convert-back
    branch entirely (it compared `newSides[i]` against `previousSides[i]` and deleted
    `previousSides[i].partitionId` on any PARTITION→PLAIN transition at the same index, which fired
    incorrectly on a plain reorder of a PARTITION side — see the review's Case A/B). The PLAIN branch now
    only decides id continuity (`previousAtSamePos?.kind === "PLAIN" ? previousAtSamePos.id :
    crypto.randomUUID()`); it never deletes. All Partition deletion happens in the single post-loop sweep
    (`removedPartitionIds`, ~L464-488), which diffs the *set* of `partitionId`s referenced before vs.
    after the write — order-independent by construction, so a PARTITION side that merely changes index
    (present in both sets) is never touched, while one that's genuinely converted back or removed outright
    (absent from the new set) still gets its `Partition` row deleted, exactly once, via a single
    `tx.partition.deleteMany({ where: { id: { in: removedPartitionIds }, organizationId, roomId } })`
    (org+room-scoped per the review's defence-in-depth suggestion, replacing the old per-id unscoped
    deletes). **Manually traced both of the review's failing scenarios against the new code**: Case A
    (`[PLAIN a, PARTITION p, PLAIN c, PLAIN d]` → `[PARTITION p, PLAIN a, PLAIN c, PLAIN d]`) — `p` ends up
    in both the before-set and after-set, `removedPartitionIds` is empty, no delete, room stays patchable.
    Case B (`[PARTITION p, PLAIN a]` → `[PLAIN a, PARTITION p]`) — same result, reorder now succeeds where
    it previously 400'd. A genuine convert-back (`[PARTITION p, PLAIN a]` → `[PLAIN(new), PLAIN a]`, `p`
    absent from the new array entirely) still deletes `p` correctly via the sweep.
  - **IMPORTANT 2 fixed** (same function, ~L385-400) — a PARTITION element with a non-null `partitionId`
    that doesn't match any PARTITION already on this room's previous `sides` now throws
    `InvalidSidesError` (`partitionId ${id} is not a side of this room.`) instead of silently falling
    through to the "new convert" branch and minting a fresh `Partition` row.
  - **MINOR 3 addressed — explicit decision: reject, not silently drop.** `lengthMm` supplied on a
    PARTITION element now returns 400 (`app/api/v1/orgs/[orgSlug]/rooms/[id]/sides/route.ts`, one check
    before the element is pushed onto `sides`) rather than being silently dropped. **Item 4's invariant-3
    test must assert a 400** when a PARTITION element carries `lengthMm`, not a 200 with the field ignored.
  - MINORs 4-8 (turnDegrees coercion, unbounded height/width, `Promise.all` on a tx client in
    `reorderRooms`, the "try again" wording on `DUPLICATE_ROOM_LABEL`, and convert-back not carrying
    `lengthMm` over from `Partition.widthMm`) were **not** addressed — out of the scope the coordinator
    asked for this pass (CRITICAL + IMPORTANT + the MINOR-3 decision only); left for a future pass or
    Item 4 to flag if any turn out to matter for test correctness.
  - **Docs**: `quotation-system-docs/design-docs/sql-queries/by-page.sql` — collapsed the sides-PATCH
    section's two separate `DELETE FROM "Partition"` steps (old steps 4/5) into the one scoped
    `deleteMany`-equivalent statement (`DELETE ... WHERE "id" = ANY(:removedPartitionIds) AND
    "organizationId" = ... AND "roomId" = ...`), renumbering the trailing `sides`-write step 6→5, matching
    the code change.
  - **Verify**: `npm run lint` — 0 errors, same 5 pre-existing unrelated warnings. `npx tsc --noEmit` —
    still exactly the same 3 expected Item-3-scope errors, nothing new. Committed `c6176e8`, pushed to
    `feature/rooms-api-dal`.
  - **Important note for Item 4**: per the coordinator's instruction, **the "ordering round-trips
    exactly" / reorder test must include a case that moves a PARTITION side's index** (not just PLAIN
    sides) — this is exactly the scenario that would have caught CRITICAL 1, and a test suite that only
    reorders PLAIN sides would pass against both the buggy and fixed code, giving false confidence.
  - No BLOCKED items.

- **2026-09-09 · reviewer · Item 2 round 2 (review-fix verification) — verdict: APPROVE-WITH-NITS.**
  0 CRITICAL · 0 IMPORTANT · 1 new MINOR (informational). Verified against `eee12fe`: the positional
  convert-back delete is genuinely gone and all three round-1 failure scenarios were hand-traced against
  the current code (both reorder cases no longer delete; a real convert-back and an outright removal still
  delete, once, via the scoped sweep); the unmatched-`partitionId` 400 is in place; MINOR 3's "reject
  `lengthMm` on PARTITION" is enforced in the route before the element is accepted, and correctly still
  allows `lengthMm: null` so a read-then-PATCH round-trip works. Re-ran `npm run lint` (0 errors) and
  `npx tsc --noEmit` (exactly the 3 expected Item-3 errors) — both claims true. `by-page.sql`'s collapsed
  single scoped DELETE matches the new logic. New MINOR: PLAIN side ids are positional, so a reorder
  reassigns them between logical sides — affects Item 3 UI keying and how Item 4 asserts round-trips.
  MINORs 4-8 re-read and confirmed non-critical; not re-flagged per coordinator scoping. Full report:
  `.engineering/stage-18/review-item2-round2.md`.

- **2026-09-09 — Item 3: design-page rework (developer agent)**: on `feature/rooms-design-page` @
  `3faab65` (pushed). Plan: `.engineering/stage-18/plan-item3.md`.
  - **Two small new API routes** required and not anticipated by Item 2's file list (flagged as a
    deviation in `plan-item3.md`): `app/api/v1/orgs/[orgSlug]/floors/route.ts` (GET `?projectId=`, POST
    create-or-get — thin wrapper around the existing, unchanged `lib/data/floors.ts`, plus a
    `getProjectById` tenancy check before create, mirroring the pre-Stage-18 add-wall action's inline
    check) and `app/api/v1/orgs/[orgSlug]/partitions/route.ts` (GET `?roomId=`, read-only, wraps
    `listPartitionsByRoom`). Needed because the `no-restricted-imports` eslint rule bans `@/lib/data/*`
    from every `app/[orgSlug]/**` file — dropping the `eslint-disable` (this item's explicit mandate)
    meant the page could no longer reach `lib/data/floors`/`lib/data/partitions` directly, and no
    floors/partitions API route existed yet (Item 2 only shipped `rooms/**`). The partitions route is
    also required because a PARTITION element in `Room.sides` carries no `label`/dimensions of its own —
    those live only on the `Partition` row.
  - **`app/[orgSlug]/projects/[projectId]/design/page.tsx`** rewritten — dropped the `eslint-disable`;
    now `internalFetch`s `fetchProjectDetail` (existing cache helper), the new `/floors` route, and
    `/rooms?floorId=` per floor, plus the existing `/selections` route for the right rail (unchanged
    behavior). Reads `?openRoom=` (Next 16 `searchParams` Promise, pattern from
    `app/[orgSlug]/projects/page.tsx`) to auto-expand a room after a create/convert redirect. Left rail
    delegates to a new `DesignLeftRail` client component instead of the flat `<ul>`.
  - **`design-left-rail.tsx`** (new, client) — Floor -> Room -> sides, sides as a **simple ordered list**
    per plan flag 4 (not a 4-bar N/S/E/W square — the mock is an interaction-pattern reference only).
    PLAIN sides are **read-only display** (`label`/`lengthMm`) with a "Convert to Partition" button —
    **no edit affordance anywhere**, per plan flag 5 (GATE A cut). PARTITION sides show
    `label — height × width mm`, fetched lazily per expanded room via the new partitions route (plain
    browser `fetch()`, precedent: `app/controls/(authenticated)/orgs/_suspend-button.tsx`) since no
    dedicated partition edit page exists anywhere in the repo — confirmed by grep, so per the task's own
    instruction nothing new was built there; the row is informational only. Per
    `review-item2-round2.md` finding 9 (PLAIN side ids are positional, not stable across reorders): this
    component never keys UI state off a PLAIN `side.id` — the convert form receives the side's **array
    index**, and every mutation redirects through the server action (fresh data on next render), so there
    is no optimistic client-side patch-by-id to go stale.
  - **`convert-side-form.tsx`** / **`new-room-form.tsx`** (new, client) — adapted from
    `add-wall/add-wall-form.tsx`'s field pattern (label + height/width + unit selector,
    `useActionState` + `LoadingOverlay`).
  - **`design/actions.ts`** (new) — `createRoomAction` (POST `/rooms`, redirects to
    `design?openRoom=<id>`) and `convertSideAction` (re-fetches the room's **current** `sides` fresh via
    `GET /rooms?floorId=` rather than trusting anything client-cached — matches `replaceSides()`'s own
    "never trust the client for array state" posture — then rebuilds the full array with only the target
    index replaced, PATCHes `/rooms/[id]/sides`). Reuses `configuration/actions.ts`'s thin-marshaler
    shape (401/403 -> login redirect, `internalFetch`, `useActionState`).
  - **Add-wall flow decision** (`design/add-wall/{page,actions,add-wall-form}.tsx`, all rewritten, dropped
    `eslint-disable`): **add-wall stays a separate top-level entry point whose only job is
    resolving/creating a Floor and a Room, then redirecting to `design?openRoom=<roomId>`** — it does
    **not** duplicate a second height/width/label conversion form. Reasoning: every Room already starts
    with 4 PLAIN sides (Item 2's default rectangle), and the design page's own "Convert to Partition"
    form (this item) already owns the one correct implementation of "which `sides` array am I patching" —
    building a second, parallel form in add-wall would duplicate that logic and require keeping the two
    in lock-step by hand for no benefit. Floor and room are both select-existing-by-exact-label-match-or-
    create free text (same UX as the pre-Stage-18 floor field), with room suggestions fetched
    client-side once the typed floor label resolves to an existing floor id. Trade-off: one extra click
    (land on design page, then pick a PLAIN side) instead of one continuous form — accepted for the reuse
    win. Full reasoning also in `add-wall/actions.ts`'s doc comment and `plan-item3.md`.
  - **i18n** — extended the existing `design` namespace in `messages/en.json` (already forwarded
    wholesale by `projects/layout.tsx`) with new keys (`newRoom`, `createRoom`, `cancel`, `sidesCount`,
    `untitledSide`, `convertToPartition`, `loadingPartition`, `continueButton`, `fieldRoom`,
    `fieldRoomPlaceholder`); no new namespace created. `wallsTitle`/`noWalls` copy updated to "Rooms"/"No
    floors added yet." to match the new hierarchy.
  - **Out of scope, not silently dropped** (see `plan-item3.md`): reorder UI (API supports it, task text
    said "if your UI supports it," not "must" — skipped to keep the item scoped); convert-PARTITION-back-
    to-PLAIN UI (API supports it, not asked for by the task's item list); a dedicated partition edit page
    (confirmed none exists, not building one per the task's own instruction).
  - **Verify**: `npm run lint` — 0 errors (one new `react-hooks/set-state-in-effect` error surfaced and
    was fixed by moving the `setRoomLabels([])` reset branch inside the effect's async function rather
    than calling it synchronously in the effect body — same 5 pre-existing unrelated warnings remain).
    `npx tsc --noEmit` — **0 errors**, confirming the 3 previously-expected errors
    (`add-wall/actions.ts:86`, `design/page.tsx:8,91`) are gone.
  - **Push + Vercel**: pushed `3faab65` to `feature/rooms-design-page`. Polled via `npx vercel inspect`
    (no Vercel MCP tools available in this session) until `READY`; confirmed the deployment actually
    cloned commit `3faab65` (not a stale/cached build) and checked the full build log route list — it
    genuinely compiles + typechecks (`✓ Compiled successfully`, `Finished TypeScript`) and lists every
    expected route: `/api/v1/orgs/[orgSlug]/floors`, `/api/v1/orgs/[orgSlug]/partitions`,
    `/api/v1/orgs/[orgSlug]/rooms`, `/rooms/[id]`, `/rooms/[id]/sides`,
    `/[orgSlug]/projects/[projectId]/design`, `/design/add-wall`. `/api/health` → 200.
  - **Manual verification — method note**: no browser/Playwright tool was available in this session, so
    the walkthrough was done via `curl` against the live preview URL rather than clicking through a
    browser — reporting this plainly per the wireframe-stage rule ("verified, reported, not skipped," not
    "verified exactly as instructed"). Signed in via better-auth's `/api/auth/sign-in/email` (real
    session token, real cookie) as `admin@acme-glass.internal` against the preview. **Discovered and
    worked around a pre-existing, unrelated issue while doing this**: `better-auth`'s
    `crossSubDomainCookies` (`lib/auth.ts`) is enabled whenever `BETTER_AUTH_URL` contains
    `"easeetool.com"`, and the Preview-environment `BETTER_AUTH_URL` Vercel env var appears to be set to
    an `easeetool.com` value (not per-deployment-URL-aware) — so the sign-in response's `Set-Cookie` had
    `Domain=.easeetool.com`, which a real browser (and `curl`, correctly, matching browser cookie-domain
    rules) would refuse to send back to a `*.vercel.app` host. This looks like it would silently break
    interactive browser login on **every** `feature/*` preview (not just this one, not caused by my diff
    — `lib/auth.ts` is untouched by Item 3), which the CLAUDE.md hard rule assumes works. Worked around
    for my own verification by manually attaching the raw session-cookie value via an explicit `Cookie`
    header (bypassing curl's domain store, which a browser cannot do) — this let me exercise the real
    authenticated code paths despite the unrelated cookie issue. **Flagging this for the human/architect
    — it's outside Item 3's scope to fix (auth config, not design-page code) but likely blocks real
    browser-based manual verification on every feature-branch preview until someone confirms/fixes the
    Preview `BETTER_AUTH_URL` value.**
  - **What was actually exercised** (against `https://quotation-system-dwklmxzec-vistra-indias-projects.vercel.app`,
    org `acme-glass`, project `#292`): `GET /design` → 200, left rail shows "No floors added yet."
    `POST /floors {label:"Ground Floor E2E"}` → 201. `POST /rooms {floorId, label:"Lobby E2E"}` → 201,
    **confirmed the response carries exactly 4 default PLAIN sides** (`turnDegrees: 90`, `isClosed: true`).
    `GET /design?openRoom=<id>` → 200, HTML shows the room auto-expanded with "4 sides" and 4 "Untitled
    wall" rows each with a "Convert to Partition" button. `PATCH /rooms/[id]/sides` converting index 0 to
    `{kind:"PARTITION", label:"North Wall E2E", heightMm:2400, widthMm:1200}` → 200, response shows side 0
    now `kind:"PARTITION"` with a real `partitionId`, sides 1-3 unchanged. `GET /partitions?roomId=` → 200,
    returns the new Partition row (`label`, `heightMm`, `widthMm` all correct). Re-fetched `/design` →
    room now shows "4 sides" with only 3 "Untitled wall" PLAIN rows (the converted one no longer PLAIN);
    the PARTITION row itself shows "Loading…" in this curl-rendered SSR snapshot because
    `DesignLeftRail`'s partition-label fetch is a client-side `useEffect` that only fires after hydration
    in a real browser — separately confirmed the `/partitions` route itself returns the correct
    label/dimensions, so this is expected SSR behavior, not a bug. `GET /design/add-wall` → 200, datalist
    shows the existing floor label. Created a second room ("Meeting Room E2E") under the same floor via
    `POST /rooms` (simulating `resolveFloorAndRoom`'s existing-floor/new-room branch) → 201, `orderIndex:1`.
    Final `/design` fetch shows both rooms listed under the one floor. Did not exercise reorder (no UI
    built, out of scope — see above).
  - No BLOCKED items. One concern carried to `DONE_WITH_CONCERNS`: the pre-existing Preview
    `BETTER_AUTH_URL`/cookie-domain issue above, which is not this item's to fix but affects anyone doing
    real browser verification on a `feature/*` preview going forward.

- **2026-09-09 · reviewer · Item 3 (design-page rework) — verdict: CHANGES-NEEDED.** 0 CRITICAL · 2
  IMPORTANT · 8 MINOR. Confirmed the two new API routes (`floors`, `partitions`) are **not** a deviation
  needing Gate A — forced, minimally-scoped, convention-conformant consequence of dropping the
  `eslint-disable`. Flags 4/5 both confirmed compliant; side-id handling vs. `review-item2-round2.md`
  finding 9 confirmed correct; add-wall decision confirmed coherent. IMPORTANT 1: the partition cache in
  `design-left-rail.tsx` checked presence, not coverage, so a second convert in the same room got stuck on
  "Loading…" after a soft-navigation redirect. IMPORTANT 2: `by-page.sql`'s "Stage 8" section documented
  deleted code (`listPartitionsByFloor`, an `INSERT INTO "Partition"` using dropped `floorId`/`location`
  columns) and had no entries for the two new routes. 8 MINORs deferred by the coordinator's explicit
  scoping (not re-flagged here). Full report: `.engineering/stage-18/review-item3.md`.

- **2026-09-09 — Item 3 review fixes (developer agent)**: on `feature/rooms-design-page` @ `a800e50`
  (pushed), fixing `review-item3.md`'s IMPORTANT 1 and IMPORTANT 2.
  - **IMPORTANT 1 fixed** (`design-left-rail.tsx`'s partition-fetch effect) — replaced the presence check
    (`if (partitionsByRoom[room.id]) continue`) with a coverage check: compute the room's current
    PARTITION-side `partitionId`s from the (always-fresh) `floors` prop, and only skip the refetch when
    every one of them is already present in the cached array (`cached !== undefined &&
    partitionSideIds.every(id => cached.some(p => p.id === id))`). A room with no PARTITION sides still
    skips entirely (unchanged short-circuit, now via `partitionSideIds.length === 0`). Applied exactly the
    reviewer's suggested fix shape.
  - **IMPORTANT 2 fixed** (`quotation-system-docs/design-docs/sql-queries/by-page.sql`, docs repo) —
    rewrote the stale "Stage 8 — Floors & Partitions (Wall Design)" section (still referencing
    `listPartitionsByFloor()`, deleted in Item 2, and an `INSERT INTO "Partition"` using
    `floorId`/`location`, dropped by Item 1's migration) as "Design page (Floor -> Room -> sides)",
    matching the real post-Item-3 data flow: `GET /design` → floors route + rooms route (pointer to the
    "Stage 18 — Rooms" section) + selections route; `GET/POST /design/add-wall` → floors + rooms routes,
    no direct `Partition` insert (wall creation moved to the sides PATCH convert, reused from the design
    page — matches `add-wall/actions.ts`'s actual behavior). Added the two routes' own SQL that had no
    entries yet: `GET/POST /api/v1/orgs/[orgSlug]/floors` (`listFloorsByProject`,
    `getProjectById` tenancy guard, `createFloorIfNotExists`) and `GET /api/v1/orgs/[orgSlug]/partitions`
    (`listPartitionsByRoom`, noted read-only with an explanation of why). Committed `6f6ad4c` in the docs
    repo and pushed to `origin/main`. Confirmed Item 2's round-2 `by-page.sql` fix (`31922ab`) was already
    committed by the coordinator before I started — did not duplicate it, only diffed against it.
  - **Verify**: `npm run lint` — 0 errors (same 5 pre-existing unrelated warnings). `npx tsc --noEmit` — 0
    errors. Committed `a800e50` on `feature/rooms-design-page` and pushed. Polled Vercel to `READY` for
    that exact commit SHA (confirmed via `vercel inspect --logs`: `Cloning ... Commit: a800e50`,
    `✓ Compiled successfully`, `Finished TypeScript`).
  - **Re-verified the multi-convert scenario** (coordinator's specific ask) against the new preview
    (`quotation-system-fnqr8kpqu-vistra-indias-projects.vercel.app`), reusing the "Lobby E2E" room from
    the Item 3 walkthrough (already `[PARTITION p1, PLAIN, PLAIN, PLAIN]`): `PATCH .../sides` converting
    index 1 to a **second** PARTITION (`{label:"East Wall E2E", heightMm:2100, widthMm:900}`, no
    `partitionId`, matching `convertSideAction`'s exact payload shape) → 200, room now
    `[PARTITION p1, PARTITION p2, PLAIN, PLAIN]`. `GET /partitions?roomId=` → 200, returns **both**
    partitions (`North Wall E2E` and `East Wall E2E`) in one call. Re-fetched `/design?openRoom=<id>` →
    200, SSR HTML shows "4 sides" and only 2 "Untitled wall" rows remaining (down from 3 after the first
    convert), consistent with 2 sides now converted.
  - **Honest limitation, stated plainly**: the IMPORTANT 1 bug is a **client-side React state** bug
    (a stale `partitionsByRoom` cache entry surviving a Next.js soft navigation after `redirect()`) — it
    cannot be reproduced or disproven via `curl`, which always gets a fresh SSR render with no persisted
    client state, whether or not the bug exists. No browser/Playwright tool was available in this session
    (same constraint as the original Item 3 verification). What I *did* verify: (a) the fix's logic
    hand-traced against the exact scenario the reviewer described — room `[p1, p2, PLAIN, PLAIN]`, stale
    cache `{room: [p1]}` → `partitionSideIds = [p1id, p2id]` → `fullyCovered` is `false` because `p2id` is
    missing from `cached` → refetch fires → and (b) confirmed via `curl` that the `/partitions` route the
    refetch calls genuinely returns **both** partitions in one response, so once the fix's refetch fires,
    the data it receives is complete and correct. This is the strongest verification available without a
    browser in this environment; a real click-through (converting two sides in a row without a hard
    reload, confirming neither gets stuck on "Loading…") is still owed and should happen at the
    `engineering:test` phase, which per CLAUDE.md's hard rule also runs against a Vercel preview, not
    locally.
  - No BLOCKED items. Concerns unchanged from the original Item 3 pass: (1) the pre-existing
    `BETTER_AUTH_URL`/cookie-domain issue on `*.vercel.app` previews (not this item's to fix, flagged for
    the human separately per the reviewer's note); (2) the client-side soft-navigation fix above is
    verified by logic + API-layer data correctness, not a literal browser click-through, for the reason
    stated.

- **2026-09-09 · reviewer · Item 3 (design-page rework) — verdict: CHANGES-NEEDED.** 0 CRITICAL ·
  2 IMPORTANT · 8 MINOR, reviewed against `3faab65`. **The two new API routes (`/floors`, `/partitions`)
  are NOT a deviation needing a Gate-A pause** — forced, minimal and convention-conformant consequence of
  the mandated `eslint-disable no-restricted-imports` removal; verdict recorded in §1 of the report.
  Flags 4 and 5 both confirmed compliant; side-id handling and the convert payload verified correct
  against the real sides-PATCH contract; tenancy/auth unregressed. `lint`/`tsc` claims re-run and true.
  IMPORTANTs: lazily-fetched partition cache is never invalidated (second convert in a room renders
  "Loading…" permanently), and `by-page.sql` not reconciled (Stage 8 section documents deleted
  columns/functions; new routes absent — plus Item 2's by-page.sql fix is still uncommitted in the docs
  repo). Full report: `.engineering/stage-18/review-item3.md`.

- **2026-09-09 — Item 3 round 2: review (reviewer agent)**: `feature/rooms-design-page` @ `a800e50`
  (fix delta since `3faab65`) + docs repo `6f6ad4c`. **Verdict: APPROVE-WITH-NITS** — 0 CRITICAL ·
  0 IMPORTANT · 2 MINOR. Both round-1 IMPORTANTs verified fixed (partition-cache coverage check traced
  against the two-converts-in-one-room scenario, no refetch loop; `by-page.sql` design-page section
  reconciled and checked against the real DAL/routes, no duplication of Item 2's round-2 fix).
  `npm run lint` 0 errors, `npx tsc --noEmit` exit 0, both re-run. Browser click-through of the second
  convert carried to `engineering:test`. Full report: `.engineering/stage-18/review-item3-round2.md`.

- **2026-09-09 — Item 4: E2E tests (developer agent)**: on `feature/rooms-tests` @ `bd60ae2` (pushed).
  - **New `tests/e2e/stage18.spec.ts`** — API-level only (`page.request.get/post/patch/delete`), no DOM
    assertions, per profile.md's testing posture. 7 tests, serial mode, one shared `acme-glass`/one shared
    `nordic-walls` browser context (sign in once in `beforeAll`, matching `subdomain-navigation.spec.ts`'s
    pattern), fixtures (1 project, 1 floor, 2 rooms) created via the real APIs. Covers, per
    `stage-18.md` §6 / the task's 9-point checklist:
    1. **Tenancy isolation** — cross-org GET returns `[]` (not a leak), cross-org PATCH-rename/PATCH-sides/
       DELETE on a foreign room id all 404, and a mismatched-orgSlug-vs-session request 403s at
       `getApiSession`'s cross-tenant guard.
    2. **No duplicate `partitionId`** — the single most important test per the stage doc: converts two
       sides to real Partitions, then attempts to place the same `partitionId` on both array slots -> 400,
       and both original Partition rows are confirmed unmodified afterward.
    3. **`Partition.roomId` agreement** — an unrecognized `partitionId` (matches nothing at all) -> 400
       with no side-effect Partition created (`review-item2.md` IMPORTANT finding 2's regression test);
       and a `partitionId` that legitimately belongs to a *different* room in the same org -> 400
       ("not a side of this room"), with the other room's Partition confirmed untouched.
    4. **Ordering round-trip + the CRITICAL reorder regression** (the highest-value test in this file, per
       the coordinator's explicit carry-forward from `review-item2.md`/`review-item2-round2.md`): labels
       4 sides, converts side **index 1** to PARTITION, then reorders it to **index 0** while the other
       3 sides simultaneously change — asserts (a) the PATCH succeeds, (b) the underlying `Partition` row
       still exists via `GET /partitions?roomId=`, (c) a follow-up PATCH on the room still succeeds (not
       "bricked", which is exactly what the original bug did). A PLAIN-only reorder would not have caught
       the original bug — this test moves the PARTITION side's own index, as required.
    5. **Convert correctness both directions** — forward: exactly one Partition row created with the right
       `roomId`/label; backward: the Partition row is deleted (`GET /partitions?roomId=` returns `[]`) and
       no side in the array carries a dangling `partitionId`.
    6. **Cascade correctness (partial)** — deleting a room removes its Partitions (`GET /partitions?roomId=`
       -> `[]`) and the room itself disappears from `GET /rooms?floorId=`. **"Deleting a floor removes its
       rooms" is NOT covered** — there is no `DELETE` route under `app/api/v1/orgs/[orgSlug]/floors/**`
       (confirmed by listing the directory: GET + POST only), and Floor is explicitly untouched by this
       stage, so there's no API-level way to drive that half of the invariant without direct DB access,
       which would break the API-level-only approach this file otherwise holds to throughout. Documented in
       a comment in the spec, not silently dropped — flagging here too for the tester/human to decide if a
       floor-delete route should be scoped into a later stage, or if this half of the invariant is accepted
       as untested until then.
    7. **Adjacency read** — folded into test 4 (no dedicated adjacency endpoint exists; the invariant is
       "array order is trustworthy," which test 4's index-by-index assertions across the reorder already
       establish, including the wrap pair).
    8. **Below-3-sides only when `isClosed: true`** — shrinking to 2 sides while closed -> 400; the same
       2-side array with `isClosed: false` -> 200.
    9. **`lengthMm` on a PARTITION element -> 400** — per Item 2's Gate-A-adjacent MINOR-3 resolution
       (`null` accepted, a real numeric value rejected); also confirms the rejected PATCH did not partially
       apply (Partition count unchanged).
  - **Real, pre-existing bug found and worked around (not fixed in product code, out of this item's
    scope)**: the shared `signIn()` helper (`tests/e2e/helpers.ts`, browser login form) is **broken against
    every ad-hoc `feature/*` Vercel preview** — confirmed by direct `curl` to
    `/api/auth/sign-in/email`: the response is a genuine `200` with a valid session token in the JSON body,
    but `Set-Cookie` carries `Domain=.easeetool.com`, which the browser (and Playwright's own cookie jar,
    same RFC 6265 rule) correctly refuses to store against a bare `*.vercel.app` host — so the login form
    "succeeds" server-side and then immediately loses the session, spinning on `/login` forever. Root
    cause: `lib/auth.ts`'s `crossSubDomainCookies.enabled` is gated on
    `BETTER_AUTH_URL.includes("easeetool.com")`, and `npx vercel env ls` confirms the Vercel **"Preview"**
    environment scope (which applies to every preview deployment, not just `staging`) has a single fixed
    `BETTER_AUTH_URL` secret — almost certainly an `easeetool.com` value — so this isn't specific to this
    branch or this item; **it affects any spec doing a browser-form `signIn()` against any feature-branch
    preview**, and was already flagged (informationally) during Item 3's manual verification pass (see the
    2026-09-09 Item 3 entries above) — this pass confirms the exact mechanism via `vercel env ls` +
    `curl`, rather than just observing the symptom. **Worked around test-harness-side only**: added a local
    `apiSignIn()` in `stage18.spec.ts` that calls the sign-in API directly via `page.request`, then
    re-attaches the returned cookie to the browser context with the `Domain` corrected to the actual host
    under test (`isSubdomain`-aware, matching `apiUrl()`'s own host-resolution logic). No product code
    touched; every other part of the flow (API routes, DB, business logic) is still the real deployed
    preview. Per the task's explicit ask to "find out and report either way" whether API-level tests are
    affected: **yes, they are affected**, because authentication itself goes through the same broken
    browser-login transport regardless of how the test body then talks to the API — the fix had to be in
    how the tests sign in, not in what they do afterward. Recommending centralizing this `apiSignIn`
    pattern into `helpers.ts` for future specs that need to run against feature-branch previews, and/or
    fixing the Preview `BETTER_AUTH_URL` env var to be less broad — left as a decision for the human/
    architect, not made unilaterally here.
  - **Verify**: `npm run lint` — 0 errors (same 5 pre-existing unrelated `tests/e2e/**` warnings).
    `npx tsc --noEmit` — 0 errors. Pushed `436752c` then `bd60ae2` (the `apiSignIn` fix) to
    `feature/rooms-tests`; polled Vercel to `READY` for **`bd60ae2`'s own commit SHA** specifically
    (`quotation-system-rigzwooex-vistra-indias-projects.vercel.app`, confirmed via `vercel inspect`), then
    ran `PLAYWRIGHT_BASE_URL=<that preview> npx playwright test stage18.spec.ts` against it:
    **all 7 tests passed** (15.8s). Also confirmed `/api/health` -> 200 connected, and the build log route
    list includes `/api/v1/orgs/[orgSlug]/rooms`, `/rooms/[id]`, `/rooms/[id]/sides` (not a stale build).
  - No BLOCKED items. One concern carried forward: the floor-delete cascade half of invariant 6 is
    untestable at the API level this stage (no route exists) — see point 6 above.

- **2026-09-09 · reviewer · Item 4 (behavior-level E2E tests) — verdict: CHANGES-NEEDED.** 0 CRITICAL ·
  2 IMPORTANT · 7 MINOR. Confirmed the Room-logic assertions themselves are strong: the no-duplicate-
  `partitionId` test and the PARTITION-index reorder test were each hand-traced against a hypothetical
  reversion of the bug they guard and both would genuinely fail. Both IMPORTANTs were in the new
  `apiSignIn()` harness, not the Room test logic: (1) the re-attached session cookie used a host-only
  `domain`, invisible on the path-routed `*.vercel.app` preview but breaking the cross-tenant 403 test on
  subdomain-routed `test.easeetool.com` (cookie never travels cross-subdomain -> 401 instead of 403 ->
  cascade-skips the other 6 tests in the `serial` file); (2) no 429 retry in `apiSignIn`, unlike the
  `signIn()` helper it replaces, exposing the whole file to better-auth's documented rate-limit flake.
  Full report: `.engineering/stage-18/review-item4.md`.

- **2026-09-09 — Item 4 review fixes (developer agent)**: on `feature/rooms-tests` @ `940d469` (pushed),
  fixing `review-item4.md`'s IMPORTANT 1 and IMPORTANT 2, plus 5 of 7 MINORs.
  - **IMPORTANT 1 fixed** — `apiSignIn`'s cookie domain in subdomain mode is now `.{base.hostname}`
    (leading dot), mirroring `lib/auth.ts`'s real `crossSubDomainCookies: { domain: ".easeetool.com" }`
    exactly, so the re-attached cookie travels cross-subdomain the same way production's does — the
    cross-tenant tenancy test now genuinely exercises the 403 guard on `test.easeetool.com` instead of
    401-ing. Path mode (`*.vercel.app`) is unaffected (still host-only, no subdomains to begin with) —
    re-ran the full suite against a fresh preview post-fix and confirmed 7/7 still pass there.
  - **IMPORTANT 2 fixed** — ported `helpers.ts`'s 4-attempt, `X-Retry-After`-aware 429 retry into
    `apiSignIn` verbatim (same shape, ~15 lines).
  - **MINORs taken**: 3 (restored `TEST_ADMIN_PASSWORD` env fallback; dropped the two call-site literals
    that were defeating it), 4 (cookie parsing now matches by `session_token` name substring across
    newline-joined `Set-Cookie` headers instead of blindly taking the first one), 5 (added an explicit
    `lengthMm: null`-on-PARTITION -> 200 assertion, closing the gap where only *omitted* and *numeric*
    were covered), 6 (added a `GET /rooms?floorId=` re-read after the reorder PATCH, not just before it),
    8 (tightened the "no duplicate Partition minted" check to compare the exact surviving partition id
    set, not just a count, per the reviewer's own regression example).
  - **MINORs not taken**: 7 (restructuring all 7 tests to use per-test fixture rooms instead of threading
    Room A/B through the file) and 9 (adding coverage for room reorder/rename/`DUPLICATE_ROOM_LABEL`) —
    both are out of `stage-18.md` §6's required invariant list per the review's own framing ("not a scope
    failure... worth naming for a later stage"), left as-is.
  - **Verify**: `npm run lint` — 0 errors (same 5 pre-existing unrelated warnings). `npx tsc --noEmit` —
    0 errors. Pushed `940d469`; polled Vercel to `READY` for that exact commit SHA
    (`quotation-system-1rc8yyqc9-vistra-indias-projects.vercel.app`, confirmed via `vercel inspect --logs`
    showing `Commit: 940d469`), confirmed `/api/health` -> 200 connected, then ran
    `PLAYWRIGHT_BASE_URL=<preview> npx playwright test stage18.spec.ts`: **all 7 tests passed** (17.3s).
  - No BLOCKED items. Same carried-forward concern as before: the floor-delete-cascades-rooms half of
    invariant 6 remains untestable at the API level this stage (no `DELETE /floors` route exists).

- **2026-09-09 · reviewer · Item 4 (behavior-level E2E tests for Rooms) — verdict: CHANGES-NEEDED.**
  0 CRITICAL · 2 IMPORTANT · 7 MINOR, reviewed against `bd60ae2`. Assertion quality confirmed **strong**
  on every point that mattered: the no-duplicate-`partitionId` test builds a genuinely duplicate scenario
  and is caught twice over; the PARTITION-index reorder test is the strong version (verifies the
  `Partition` row survives via `GET /partitions` **and** that a follow-up PATCH still 200s) and was traced
  against the old buggy `replaceSides` to confirm it would have failed there; convert-back is verified via
  the partitions list, not just the sides array; tenancy uses two real orgs with correct 403-vs-404
  expectations traced against `getApiSession`/`replaceSides`; below-3/`isClosed` and `lengthMm`-400 match
  the Gate-A resolutions. Floor-delete gap confirmed accurate, legitimate, and documented three ways —
  not something Item 2 should have built. `npx tsc --noEmit` exit 0 and `npm run lint` 0 errors both
  re-run and true; no product code touched. Both IMPORTANTs are in the new `apiSignIn()` harness, not the
  assertions: (1) the cross-tenant 403 assertion will 401 against `test.easeetool.com` because the
  re-attached cookie is host-only, and as test #1 of a `serial` file it would cascade-skip the other six;
  (2) no 429 retry, unlike the `signIn()` helper it replaces, so the repo's documented rate-limit flake
  fails all 7 tests via `beforeAll`. Both are small local fixes. Full report:
  `.engineering/stage-18/review-item4.md`.

- **2026-09-09 · reviewer · Item 4 round 2 (review fixes @ `940d469`) — verdict: APPROVE-WITH-NITS.**
  0 CRITICAL · 0 IMPORTANT · 2 MINOR. Both round-1 IMPORTANTs verified fixed by reading the code against
  `lib/auth.ts` and `tests/e2e/helpers.ts` (not taken on faith); MINORs 3/4/5/6/8 closed, 7/9 consciously
  deferred. `npx tsc --noEmit` exit 0 and `npm run lint` 0 errors / same 5 pre-existing warnings, both
  re-run. Test file only; no product code, no weakening of any round-1-confirmed-strong test. Item 4 is
  ready; Stage 18 can move to `engineering:test`. Full report:
  `.engineering/stage-18/review-item4-round2.md`.

- **2026-09-09 — implement orchestrator: STAGE REOPENED for item 7.** Items 1-4 had already merged to
  `release/stage-18` and been merged onward to `staging`; the human then compared item 4's shipped
  list-only left rail against `design-docs/mockups/design-step-poc.html` mid-`engineering:test` and
  judged the gap too large to ship — explicit direction: rebuild the Design page to look and behave
  exactly like the mockup, in this same stage, not a new one. Stage doc amended with new scope item 7
  (see `stage-18.md` §7 for the full spec, including the one flagged model gap: the mockup's wall-bar
  diagram is hardcoded to 4 fixed sides, but must render generically over the real arbitrary-length
  `sides[]` array). `release/stage-18` re-checked-out (was already clean, `staging` merge did not delete
  it). UI-only — no schema/route changes expected; any such need is a Gate-A deviation, not a silent
  addition. Human explicitly asked for the architect to be involved given the size/complexity of matching
  the mockup's interaction set (floor bar, collapsible room list w/ per-partition preview swatches,
  layout-mode floor-plan diagram, configure-mode panel/door/edge-profile editor, unit toggle).
  Dispatching developer to write `plan-item7.md`, then architect (Mode B) to verify it against
  `stage-18.md` §7 and the mockup before any code is written.

- **2026-09-09 — Item 7 plan (developer agent)**: `plan-item7.md` written (no code yet). Read
  `stage-18.md` §7, the full mockup, `lib/data/rooms.ts`/`partitions.ts`, the current `design/**` tree,
  `app/globals.css` tokens, and the `Selection`/`ComponentType`/`ComponentCategory` schema. **Floor-plan
  model gap resolved concretely**: one generic `RoomFloorPlan` SVG component keyed purely off
  `sides.length`/array index (never named slots) — `N===4` uses the square's own 4 corners as vertices
  (reproduces the mockup's literal square for the common default-room case), `N!==4` uses a regular N-gon
  inscribed in a circle; open runs (`isClosed:false`) simply omit the wrap segment. Satisfies §7's "must
  not hardcode top/left/right/bottom, must not truncate" requirement while keeping the mockup's visual
  language (bars, hover tooltips, legend, click-to-convert). **6 items flagged at the top for the
  architect/human gate**, none touching schema: (1) a new `GET`/`PATCH
  /api/v1/orgs/[orgSlug]/partitions/[id]` route to write `label`/`heightMm`/`widthMm`/the existing
  `design` JSONB (Configure mode has no write path today) — argued as forced/minimal, same reasoning
  Item 3's `floors`/`partitions` routes got waved through on; (2) the floor-plan rendering approach above;
  (3) the mockup's fixed 3-bucket `COMPONENT_LIBRARY` (partitions/doors/profiles) doesn't map to the real
  catalog's free-text `ComponentCategory.name` — resolved by grouping the project's actual `Selection`
  rows by their real category name dynamically, not a hardcoded 3; (4) mockup applies one glass choice to
  a whole wall in one click, real schema stores `selectionId` per-panel — resolved by writing the same
  selectionId onto every panel in one PATCH, reproducing the UX with the existing field, no per-panel
  override UI; (5) `design.panels[].door.hinging` has no picker in the mockup either, so none is built,
  defaulted to `"left"`; (6) **the one flagged as most worth a second look** — replacing Items 1–4's
  `useActionState`+`redirect()` mutation pattern with plain client-side `fetch()` + local state updates
  for in-page navigation and mutations, to match the mockup's instant no-reload interaction feel (a full
  page nav per click would not read as "exactly like the mockup"). Proposed file/component breakdown
  (new `design-workspace.tsx` as the single client state owner, mirroring the mockup's one `renderAll()`
  state machine; `RoomFloorPlan`, `configure-mode.tsx`/`wall-canvas.tsx`/`edge-profile.tsx`,
  `saved-components-rail.tsx`, `unit-context.tsx`/`unit-toggle.tsx`). Verification plan: `lint`/`tsc`
  locally, push + Vercel `READY` + route-list check, a small new API-level (no-DOM) E2E addition to
  `stage18.spec.ts` for the new partition route's tenancy + `design` JSONB round-trip, and an explicit
  manual visual side-by-side against the mockup (flagged as needing a real browser tool this time, unlike
  Items 3/4's curl-only workarounds, since "looks like the mockup" can't be verified via curl). **Proposed
  serial, one developer, 3 ordered pieces** (Layout-mode shell+floor-plan → Configure-mode editor →
  polish/unit-toggle/tests) — recommended against parallel dispatch since all 3 pieces converge on the
  same `design-workspace.tsx` state owner and shared `unit-context.tsx`, which would put two developers
  editing the same files concurrently. No BLOCKED items — all flags are informational/for-confirmation,
  not stoppers, per the plan's own framing. Full detail in `plan-item7.md`.

- **2026-09-09 · architect (Mode B) · Item 7 plan verification — verdict: PROCEED with corrections.**
  Flags 1, 2, 4, 5 waved through (1 = new route over the pre-existing `Partition.design` field, same
  precedent as Item 3's floors/partitions routes — inform the human, don't block; 2 = satisfies §7, plus
  a fidelity fix: mitred quads not straight lines so N=4 matches the mockup). Flag 6 approved
  **conditionally**: view/selection-as-client-state isn't a deviation, but every full-array/full-document
  write (`sides`, `design`) must re-read server state immediately before building the payload — the
  client must never be the source of a destructive replace (Item 2's CRITICAL was exactly that). **Flag 3
  must be corrected before code — its premise is factually wrong**: orgs get one seeded category
  ("Glass Partitions") with three ComponentTypes coded GLASS/DOOR/PROFILE_STOP, so group and gate the
  rail by `componentType.code` (precedent: `lib/component-icons.tsx`), not `category.name`. Four further
  gaps the plan missed: cross-tenant `selectionId` validation on the design PATCH, keeping
  `Partition.widthMm = sum(panels[].widthMm)`, redundant `panels[].index`, and unnamed mockup
  interactions (Escape/click-out/disabled states/hint). Serial 3-piece split agreed; move the
  `partitions/[id]` route+DAL+E2E to the front of Piece 2. **One item escalated to the human:** the
  `BETTER_AUTH_URL` preview-login bug blocks the browser-based visual QA this item's acceptance depends
  on — fix the Preview env var (devops) or accept verification only at `test.easeetool.com` post-merge.
  Full review: `.engineering/stage-18/architect-review-item7.md`.

- **2026-09-09 · GATE A (human).** Plan approved to proceed with all of the architect's corrections
  folded in (flag 3 corrected to group/gate by `componentType.code`, not `category.name`; cross-tenant
  `selectionId` validation on the `design` PATCH; `Partition.widthMm` derived from `panels[].widthMm`;
  drop redundant `panels[].index`; flag 6's re-read-before-write condition is binding). On the one
  escalated item: **accept post-merge-only visual verification** — build normally on
  `feature/design-canvas`, do the real browser side-by-side against `design-step-poc.html` once merged to
  `release/stage-18`/`staging` and reachable at `test.easeetool.com` (subdomain routing, `BETTER_AUTH_URL`
  bug doesn't block login there). No devops fix requested this stage. Proceeding to Step 4 (dev↔reviewer
  loop), Piece 1 (Layout-mode shell + floor-plan) first.

- **2026-09-09 — Item 7 Piece 1: Layout-mode shell (developer agent)**: on `feature/design-canvas`.
  Own plan: `.engineering/stage-18/plan-item7-piece1.md`. No schema/route changes — Piece 2 owns the new
  `partitions/[id]` route.
  - **New**: `design/types.ts` (shared `RoomSide`/`RoomRow`/`FloorRow`/`FloorWithRooms`/`PartitionRow`/
    `SelectionRow`/`ViewMode` types — `ViewMode` includes `'configure'` now so Piece 2 can extend
    `design-workspace.tsx` without a signature change); `design/login-redirect.ts` (client-side 401/403 ->
    login redirect, built from an `isSubdomain` boolean the server computes via `detectIsSubdomain()` and
    forwards as a prop — same pattern `project-wizard-breadcrumb.tsx` already uses, since `orgHref()`/
    `detectIsSubdomain()` read `next/headers()` and can't run client-side, per architect-review-item7.md
    binding requirement 4); `design/unit-context.tsx` + `unit-toggle.tsx` (presentation-only `UnitProvider`/
    `useUnit()`, canonical mm, mirrors the mockup's `toDisplay`/`fromDisplay`/`formatLen`; mounted in the
    Design page's own header row, not the shared wizard breadcrumb — see plan's "what can't be exactly the
    mockup"); `design/floor-bar.tsx` (`<select>` + inline "+ Floor" form, client `fetch()` to
    `POST /floors`); `design/room-list.tsx` (replaces `design-left-rail.tsx` — collapsible room groups
    scoped to the selected floor, chevron, generic "N sides" count, "+ Add Room" inline form; only lists
    already-*converted* partitions in the expanded body, matching the mockup's own split — plain-side
    conversion now happens via the floor-plan diagram, not a per-side list button); `design/
    partition-preview.tsx` (small non-interactive to-scale swatch — a flat-colour rectangle sized to the
    partition's width:height aspect ratio; explicitly a stub per the task's own carve-out, since real
    panel/door rendering needs Configure mode's canvas primitives, not fetched this piece);
    `design/room-floor-plan.tsx` (generic SVG `RoomFloorPlan` — N vertices from `sides.length`/array index
    only, **never** a named top/left/right/bottom lookup: N=4 uses the drawing square's own 4 corners,
    N!=4 uses a regular N-gon inscribed in a circle; each side is a **mitred quadrilateral** — outer edge =
    vertex-to-vertex span, inner edge = line-intersection of the two adjacent inward-offset edges (or a
    straight perpendicular inset at an open run's endpoint) — per architect-review-item7.md's binding
    fidelity correction, not the plan's original plain `<line>`; diagonal-stripe `<pattern>` fill for
    `is-partition` sides; one computed floating tooltip instead of 4 CSS rules; click-to-select,
    background-click-to-deselect, hover, selected/dimmed, legend); `design/layout-mode-panel.tsx`
    (right-rail content for a selected side — `ConvertSideForm` for a PLAIN side, or a summary +
    inert/disabled "Configure Partition ->" button for a PARTITION side, per the task's explicit
    Piece-1 carve-out); `design/design-workspace.tsx` (the new single client state owner —
    `selectedFloorId`/`selectedRoomId`/`viewMode`/`layoutSideSelection`/`activePartitionId` (wired, unused
    until Piece 2), mounts `UnitProvider`, owns the 3-column grid, Escape-to-clear-selection (global
    keydown listener) and background-click-to-deselect (per architect-review-item7.md missed-interactions
    list) — `viewMode` only ever reaches `'empty' | 'layout'` this piece).
  - **Rewritten** (plan-item7.md flag 6, approved conditionally): `convert-side-form.tsx` and
    `new-room-form.tsx` — client `fetch()` instead of `useActionState` + `redirect()`, no more page nav per
    mutation. **`convert-side-form.tsx` re-reads `GET /rooms?floorId=` fresh immediately before building
    the `sides` PATCH payload** (never trusts a stale prop/cache) — the exact binding condition
    architect-review-item7.md attached to flag 6, ported verbatim from the now-removed
    `convertSideAction`'s own "never trust the client for array state" posture. Both forms redirect to
    login via `login-redirect.ts` on a 401/403 response (binding requirement 4) instead of silently
    swallowing it. `page.tsx` — stays the Server Component data-fetching entry point (floors + rooms +
    selections via `internalFetch`, unchanged sources) plus `detectIsSubdomain()`, now hands off to
    `<DesignWorkspace>` instead of rendering the 3-column layout inline; still reads `?openRoom=` once on
    initial load (set by `add-wall/actions.ts`'s unchanged server-side redirect, a genuine top-level entry
    point) as `design-workspace.tsx`'s `initialOpenRoomId` prop.
  - **Removed**: `design-left-rail.tsx` (superseded), `design/actions.ts` (`createRoomAction`/
    `convertSideAction` — confirmed via grep nothing else called them; `add-wall/actions.ts` is a separate
    file, untouched, per the plan).
  - **i18n**: extended the existing `design` namespace in `messages/en.json` (unit toggle wasn't a new
    string — no per-unit strings needed since it's just "mm"/"in"/"m"). Removed 6 keys that became fully
    unused after the rewrite (`addAnotherWall`, `unitMm`, `unitFeet`, `submitAddWall`, `wallDisplay`,
    `untitledSide` — confirmed via grep across `app/**` before removing); added ~20 new keys (floor-plan
    legend/tooltip text, convert/summary panel titles, empty-state copy, `roomsSummary`/`selectionsAvailable`
    ICU plurals). `fieldFloor`/`fieldRoom`/`continueButton` kept — still used by the untouched
    `add-wall-form.tsx`.
  - **Flag 3 (right-rail grouping by `componentType.code`) is NOT implemented this piece** — the
    Saved-Components rail itself is Configure-mode UI (Piece 2); `selections` is fetched server-side and
    threaded down to `design-workspace.tsx` as before, but Piece 1's right rail only ever shows the
    layout-mode side panel or a plain "N saved components" count hint (`selectionsAvailable`), never a
    grouped list — flagging so Piece 2 doesn't mistake this for "already done."
  - **Verify**: `npm run lint` — 0 errors (same 5 pre-existing unrelated `tests/e2e/**` warnings; one new
    `react-hooks/set-state-in-effect` surfaced and was fixed the same way Item 3 fixed its equivalent —
    wrapped the reset branches in an async function inside the effect rather than calling `setState`
    directly in the effect body). `npx tsc --noEmit` — 0 errors.
  - **Push + Vercel**: pushed `a67b75e` to `feature/design-canvas`. `npx vercel`'s npx cache was corrupted
    (`ERR_MODULE_NOT_FOUND` on a stale `_npx/<hash>` dir) — cleared it (`rm -rf` that one cache dir, not a
    global npx wipe) and `npx vercel@latest` worked cleanly afterward; flagging in case another agent hits
    the same stale-cache symptom. Polled `vercel ls` → `vercel inspect --logs` until the branch's own
    deployment (`quotation-system-ia8mhzp4v-...vercel.app`) was `Ready`; confirmed via the build log it
    genuinely cloned **`Commit: a67b75e`** (not stale), `✓ Compiled successfully`, `Finished TypeScript`,
    and the route list is exactly unchanged from before this piece (`/design`, `/design/add-wall`,
    `/api/v1/orgs/[orgSlug]/floors`, `/partitions`, `/rooms`, `/rooms/[id]`, `/rooms/[id]/sides` — no new
    routes, as expected for Piece 1). `/api/health` → 200 connected.
  - **Manual verification — method note, same constraint as Items 3/4**: no browser/Playwright tool was
    available in this session, so verification is `curl` + a manually re-attached session cookie (same
    `BETTER_AUTH_URL`/`crossSubDomainCookies` workaround Item 3 documented — `Set-Cookie` carries
    `Domain=.easeetool.com`, refused by a `*.vercel.app` host, worked around by attaching the raw cookie
    value via an explicit header). **What this proves and doesn't**: confirms the page renders (200, no
    500/error boundary) in both the zero-floors empty state (`t("noWalls")` branch: "No floors added yet.",
    unit-toggle mm/in/m buttons present, "Saved Components" / "No saved components yet" right-rail hint)
    and, after creating a floor + room via the real API, the Layout-mode floor-plan SSR path (`GET
    /design?openRoom=<roomId>` → 200; SSR HTML contains exactly 5 `<polygon>` elements — 4 mitred wall-bar
    quads + 1 dashed interior polygon, matching the N=4 closed-room case — 4 `cursor-pointer` clickable
    segments, the legend's "Wall"/"Partition" labels, and "4 sides"). **Cannot verify via curl**: the actual
    click interactions (select a side, convert-to-partition form, Escape/background-click-to-deselect, the
    unit toggle actually converting values) — all client-side React state changes with no server round trip
    by design (that's the point of flag 6), so there's no SSR artifact to grep for. Per GATE A's decision,
    the full browser-based visual side-by-side against `design-step-poc.html` is deferred to
    `test.easeetool.com` post-merge — stating this plainly rather than approximating further with curl.
  - No BLOCKED items. One concern for the reviewer: the interactive-state paths (click-to-convert,
    Escape/background-deselect, unit-toggle math) are implemented per the mockup's own logic and compile/
    lint clean, but are **not yet exercised end-to-end** by anything — the reviewer or `engineering:test`
    tester should prioritize a real click-through of these once a browser is available.

- **2026-09-09 · reviewer · Item 7 Piece 1 (Layout-mode design-canvas shell) — verdict: CHANGES-NEEDED.**
  0 CRITICAL · 2 IMPORTANT · 8 MINOR, reviewed against `a67b75e`. Both of the architect's binding
  corrections that this piece carried were traced in the code and confirmed **genuinely implemented**, not
  just claimed: the floor plan really does render mitred quadrilaterals generic over N (no named-side
  lookup anywhere), and `convert-side-form.tsx` really does re-read `GET /rooms?floorId=` inside `submit()`
  and rebuild the full `sides` array from the server's copy (diffed line-by-line against the deleted
  `convertSideAction` — identical logic, only transport differs). 401/403 handling present on all mutating
  fetches. `npx tsc --noEmit` exit 0 and `npm run lint` 0 errors / same 5 pre-existing warnings, both
  re-run. Tenancy unchanged (no new routes); no new automated DOM assertions. IMPORTANT 1: the unit toggle
  lives outside `ConvertSideForm` and the width/height inputs are raw strings, so switching mm→m mid-form
  reinterprets the typed numbers at submit — a 1000x-too-large `widthMm`/`heightMm` is persisted with no
  range validation anywhere downstream; the mockup can't hit this because `renderAll()` rebuilds those
  inputs on every unit change. IMPORTANT 2: the Layout-mode room-name **input** was dropped (static `<h3>`
  instead) — named explicitly in `architect-review-item7.md`'s missed-interactions list and in
  `plan-item7.md`'s reuse map, and orphaned by both remaining pieces; `PATCH /rooms/[id]` now has zero
  callers app-wide as a result. MINORs: read-only partition fetches swallow 401/403, new room prepended
  client-side but appended server-side, no default convert dimensions, `sidesCount` not pluralised, one
  dead i18n key (`canvasPlaceholder`), unguarded `sides[sideIndex]` index, four floor-plan/left-rail
  fidelity nits for the deferred visual QA, and a take-or-leave dedup of the two partition caches. Full
  report: `.engineering/stage-18/review-item7-piece1.md`.

- **2026-09-09 · developer · Item 7 Piece 1 — review fixes (both IMPORTANTs + MINORs 3/4/6/7).**
  Plan: `.engineering/stage-18/plan-item7-piece1-fixes.md`.
  - **IMPORTANT 1** (`convert-side-form.tsx`): replaced the raw width/height input strings with
    canonical-mm state (`heightMm`/`widthMm`), plus a per-render-derived display string (`toDisplay()`)
    and a raw-text mirror for free typing. On a unit-toggle change, the stale text mirror is cleared
    (via the "adjust state during render" pattern, not a `useEffect`, to dodge
    `react-hooks/set-state-in-effect`) so the display re-derives from the *same* canonical mm through the
    new unit — a value typed as 900mm and submitted after switching to `m` now still submits 900mm, not
    900m. Submit no longer calls `fromDisplay()` at all; it reads the canonical mm state directly.
  - **IMPORTANT 2** (new `room-name-input.tsx`, wired into `design-workspace.tsx`): added the missing
    Layout-mode editable room-name input (mirrors `new-room-form.tsx`'s fetch pattern). Commits on
    blur/Enter via `PATCH /api/v1/orgs/[orgSlug]/rooms/[id]` (Item 2's rename route — first caller
    anywhere in `app/**`), handles 401/403 via `redirectToLogin`, reverts to the server label on
    failure/empty/unchanged input, and updates `floors` state on success (`handleRoomRenamed`, same
    shape as the existing `handleSideConverted`) so the left-rail room list picks up the new label
    without a reload. Escape reverts the local draft without committing.
  - **MINOR 3**: added 401/403 → `redirectToLogin` to the two read-only partition GETs
    (`design-workspace.tsx`'s room-partitions effect, `room-list.tsx`'s per-room fetch).
  - **MINOR 4**: `handleRoomCreated` now appends (`[...f.rooms, room]`) instead of prepending, matching
    `createRoom()`'s server-side `orderIndex` / `listRoomsByFloor()`'s ordering.
  - **MINOR 6**: `design.sidesCount` in `messages/en.json` is now an ICU plural
    (`"{count, plural, =1 {1 side} other {# sides}}"`).
  - **MINOR 7**: removed the dead `design.canvasPlaceholder` key.
  - Not taken (per orchestrator instruction): MINOR 8 (bounds guard), MINOR 9 (floor-plan cosmetic nits
    — deferred to post-merge visual QA), MINOR 10 (partition-cache dedup — only if Piece 2 touches it).
  - Verify: `npx tsc --noEmit` → exit 0. `npm run lint` → 0 errors, 5 warnings, all pre-existing and in
    `tests/e2e/**` (identical baseline to the review). Pushed `feature/design-canvas` (fix commit `4a0b48f`, worklog-only follow-up `c3b96c4`), polled Vercel
    to `READY` for `c3b96c4` (`dpl_Bxof2yQFhRiXSH52x1KntYpPzwh9`,
    `quotation-system-3xzuq6d6z-vistra-indias-projects.vercel.app`, aliased under
    `quotation-system-git-feature-desi-…`), `/api/health` 200 with `database: "connected"`.
  - Files: `convert-side-form.tsx`, `design-workspace.tsx`, `room-list.tsx`, new `room-name-input.tsx`,
    `messages/en.json`.
  - Status: DONE.

- **2026-09-09 · reviewer · Item 7 Piece 1 round 2 (full Piece 1 diff, `4a0b48f`) — verdict:
  APPROVE-WITH-NITS.** 0 CRITICAL · 0 IMPORTANT · 4 MINOR (3 new + the round-1 MINORs consciously not
  taken). Both round-1 IMPORTANTs traced in the code and confirmed genuinely fixed, not just claimed;
  the four claimed MINOR fixes are real; both architect-mandated corrections re-confirmed unregressed
  (fix commit touched only 5 files — `room-floor-plan.tsx` byte-identical, and the convert form's
  re-read-before-write survived the unit refactor). `npx tsc --noEmit` exit 0 and `npm run lint`
  0 errors / same 5 pre-existing `tests/e2e/**` warnings, both re-run. New MINORs: duplicate-label
  rename → 500 + silent revert (`renameRoom` lacks the `P2002` catch `createRoom` has; `RoomNameInput`
  has no error surface), an inaccurate text-mirror comment Piece 2 will copy, an untrimmed-value echo
  that self-heals, and a Piece-3 E2E pointer for the rename round-trip. Piece 1 is done; Piece 2
  (Configure mode) can start. Full report:
  `.engineering/stage-18/review-item7-piece1-round2.md`.

- **2026-09-09 — Item 7 Piece 2: Configure mode (developer agent)**: on `feature/design-canvas`. Own
  plan: `.engineering/stage-18/plan-item7-piece2.md`. Implements the 5 architect-mandated corrections to
  `plan-item7.md` from `architect-review-item7.md` (Flag 3 corrected grouping, cross-tenant `selectionId`
  validation, derived `widthMm`, dropped `panels[].index`, re-read-before-write).
  - **New route + DAL (front of this piece, per architect sequencing)**: `lib/data/partitions.ts` — added
    `updatePartition(session, id, patch)` (tenancy-guard-then-update, mirrors `renameRoom`'s shape) plus
    `DesignDoor`/`DesignPanel`/`DesignStops`/`PartitionDesign`/`UpdatePartitionPatch` types and an
    `InvalidDesignError` class. Reused the existing `getPartitionById` for the GET side rather than adding
    a redundant `getPartitionByIdForOrg` (identical signature already existed). `updatePartition`: (a)
    merges a partial `design` patch onto the previously-stored document rather than replacing it wholesale
    — `measurements`/`distribution` (documented keys this UI doesn't touch) survive untouched; (b)
    collects every `selectionId` referenced in `panels[].selectionId`/`panels[].door.selectionId`/
    `stops.*` and verifies each resolves to a real `Selection` with the SAME `organizationId` AND the same
    `projectId` (via `room.floor.projectId`) as this partition — throws `InvalidDesignError` listing the
    offending id(s) otherwise, never silently drops or accepts a foreign reference; (c) derives
    `widthMm = sum(panels[].widthMm)` server-side whenever `patch.design.panels` is present — never
    accepts a client-supplied `widthMm` (there is no `widthMm` field in `UpdatePartitionPatch` at all).
    `app/api/v1/orgs/[orgSlug]/partitions/[id]/route.ts` (new) — `GET` (tenancy-scoped single partition)
    + `PATCH` (`label?`, `heightMm?`, `design?`), following `rooms/[id]/route.ts`'s exact
    `getApiSession`/`ApiAuthError`/`apiNotFound`/`apiBadRequest` structure. The route does thin shape
    validation only (types, panel array shape, positive numbers, door sub-object shape); every invariant
    check lives in the DAL, matching the `sides` PATCH route's split. `design.panels[].index` is never
    parsed or emitted anywhere in the route or DAL — array position is authoritative, per the architect's
    binding correction.
  - **Client types** (`design/types.ts`): added `DesignDoor`/`DesignPanel`/`DesignStops`/`PartitionDesign`
    mirroring the DAL types (duplicated per the existing client/server type-duplication convention this
    tree already uses), extended `PartitionRow` with an optional `design` field, and added
    `EdgeSide`/`ConfigureSelection`/`PartitionPatch`/`MutateResult` for the new components below.
  - **`configure-mode.tsx`** (new) — toolbar row (back button restoring the originating Layout-mode side
    selection, name input committing on blur/Enter via the shared `mutate` transport, floor·room +
    panel-count tags, width/height dimension inputs using **the exact canonical-mm pattern from
    `convert-side-form.tsx`'s fixed version** — canonical value from the live `partition` prop, a raw-text
    mirror cleared on unit-change-during-render, reset on partition-id-change during render, never a
    stale unit-mismatched string). Width is edited as a **proportional rescale of every panel** (matches
    `design-step-poc.html:1075-1082`'s `scale = newTotal/oldTotal` exactly, in mm) since `widthMm` itself
    is server-derived, not a direct field — editing "width" always ends in a `design.panels` PATCH, never
    a raw `widthMm` PATCH. Height edits `heightMm` directly and clamps any door's `outerFrame.h` to the
    new (possibly shorter) wall height, matching the mockup. Add/Remove/Split-panel toolbar buttons
    reproduce the mockup's exact enable/disable rules (`panels.length<=1`, `widthMm < MIN_SPLIT_WIDTH_MM`)
    and logic (split moves selection to the first new half). Contextual hint line under the toolbar
    (architect-review-item7.md missed-interaction #4). Background-click-to-deselect on the canvas wrap
    (children `stopPropagation`); Escape-to-clear-selection is handled by extending
    `design-workspace.tsx`'s existing single keydown listener (keyed on `viewMode`) rather than a second
    listener.
  - **`wall-canvas.tsx`** (new) — to-scale panel row (`flexBasis = widthMm/totalWidthMm*100%`, mm instead
    of the mockup's inches), door notch as a bottom overlay sized to `door.outerFrame.h / heightMm`, a
    door-height range slider shown only on the selected door panel. **Door height is stored in
    `door.outerFrame.h`** — `04-data-model.md`'s documented `door` shape has no separate height field, and
    `outerFrame: {w,h}` already documents the door leaf's own outer dimensions, which is exactly what the
    mockup's slider controls; reusing it avoids inventing a new field for a mockup interaction the
    architect review didn't separately flag. Slider commits on release (`onMouseUp`/`onTouchEnd`), not
    every drag tick, via the same re-read-before-write `mutate` transport — a local `pendingHeight` state
    gives live visual feedback during the drag without spamming PATCHes.
  - **`panel-list.tsx`** (new) — itemized rows under the canvas, same click-to-select as the canvas
    (`renderPanelList`).
  - **`edge-profile.tsx`** (new) — the 4 top/left/right/bottom pickers (a genuinely fixed 4-slot concept
    here, `design.stops`, unlike the room's arbitrary-N `sides[]` — no generalization built, per the
    task's own framing), each showing the assigned `PROFILE_STOP` Selection's label or an empty state,
    selected/dimmed states mirroring the mockup's mutual panel/edge exclusivity.
  - **`saved-components-rail.tsx`** (new) — right rail in Configure mode, **grouped and gated by
    `Selection.componentType.code`** (`GLASS`/`DOOR`/`PROFILE_STOP`), per architect-review-item7.md's
    correction to the plan's originally-wrong `category.name` grouping — verified `lib/data/
    selections.ts`'s `listSelections` already `select`s `code: true` on `componentType` (Item 3-era
    query, unchanged), so no DAL/route change was needed to expose it, only a new client component
    reading an already-present field. GLASS section always enabled (click writes that `selectionId` onto
    **every** panel in one PATCH — flag 4, already approved); DOOR enabled only with a panel selected
    (toggle on/off, default height `max(MIN_DOOR_HEIGHT_MM, round(wallHeight*0.85))` mirroring the
    mockup's `defH`, `hinging` always `"left"` — flag 5, no picker); PROFILE_STOP enabled only with an
    edge selected (writes `design.stops[side]`). Any Selection whose code isn't one of the 3 renders in a
    trailing **display-only "Other"** section (architect's explicit ruling) — not a hardcoded 3, empty
    sections are simply absent.
  - **Wiring**: `layout-mode-panel.tsx`'s "Configure Partition →" button is no longer `disabled` — calls
    a new `onConfigure(partitionId, sideIndex)` prop. `design-workspace.tsx`: new `activePartition`/
    `configureSelection`/`configureFromSideIndex` state, a new effect fetching
    `GET /partitions/[activePartitionId]` (full `design` document) whenever Configure mode's active
    partition changes, and the centralized `mutatePartition()` transport (re-read-`GET`-then-`PATCH`-then-
    sync-local-state, used by every Configure-mode mutation site — `configure-mode.tsx`,
    `saved-components-rail.tsx` — so the re-read-before-write condition is enforced once, not
    per-callsite) which also patches the matching entry in `selectedRoomPartitions` on success so the
    floor-plan tooltip/left-rail preview stay current without a reload. Center/right columns render
    `<ConfigureMode>`/`<SavedComponentsRail>` when `viewMode === 'configure'`. Back button restores
    `layoutSideSelection` to the side index that opened Configure mode.
  - **i18n**: extended `design` namespace in `messages/en.json` with ~20 new keys (toolbar/hint/edge/door/
    section copy); removed the now-dead `configurePartitionComingSoon` key (the button it labelled is no
    longer disabled). Re-scripted every `t("…")` call in `design/**` against `en.json`: 0 missing keys, 0
    dead keys (the `edgeTop`/`edgeLeft`/`edgeRight`/`edgeBottom` keys are looked up dynamically via
    `EDGE_LABEL_KEY[side]`, not literal `t("...")` calls, so a naive grep flags them as unused —
    confirmed by hand they're exercised in `edge-profile.tsx` and `configure-mode.tsx`'s hint line).
  - **Docs**: `quotation-system-docs/design-docs/sql-queries/by-page.sql` — new sections for
    `GET`/`PATCH /api/v1/orgs/[orgSlug]/partitions/[id]` immediately after the existing
    `GET .../partitions?roomId=` section, including the cross-tenant `Selection` validation read and the
    whole-JSONB `UPDATE ... SET "design" = :designJson::jsonb, "widthMm" = :derivedWidthMm, ...` write,
    per the stage's own convention of writing these out rather than placeholders. Not yet committed in the
    docs repo (same posture as Item 3: uncommitted docs-repo changes accumulate until an orchestrator
    commits them together — confirmed the pre-existing uncommitted stack from earlier items is still
    there, untouched by me).
  - **Verify**: `npx tsc --noEmit` — 0 errors. `npm run lint` — 0 errors, same 5 pre-existing
    `tests/e2e/**` warnings (one new `no-unused-vars` on an `EDGE_SIDES` constant surfaced during
    development and was removed, not suppressed).
  - **New E2E** (`tests/e2e/stage18.spec.ts`, extended): a dedicated Room C + Partition fixture (not
    reusing Room A/B, which earlier tests in the file mutate down to 0 partitions by the end), Selections
    for GLASS/DOOR/PROFILE_STOP created via the real APIs, plus a second ACME project (cross-project,
    same-org fixture) and a NORDIC project+Selection (cross-org fixture), all set up in `beforeAll`. Three
    new tests: (1) tenancy — cross-org `GET`/`PATCH /partitions/[id]` 404, cross-org-slug 403, own-org 200;
    (2) cross-tenant `selectionId` rejection — a same-org-different-project `selectionId` in `panels[]`
    400s, a different-org `selectionId` in `panels[]` 400s, a different-org `selectionId` in `stops.top`
    400s, and confirms neither rejected write partially applied (0 panels persisted); (3) a legitimate
    round-trip — writes 2 panels (one with a door referencing the real `doorSelectionId`) + 2 `stops`
    entries, asserts the response AND a fresh re-`GET` both show `widthMm` **derived** as
    `sum(panels[].widthMm)` (700+900=1600, never the value that would result from trusting a client-sent
    widthMm, which was never even sent), then removes one panel and confirms `widthMm` re-derives again
    (700) — proving the derivation isn't a one-time computation frozen at first write.
  - **Push + Vercel**: pushed `ff571e4` to `feature/design-canvas`
    (`quotation-system-hana07kr6-vistra-indias-projects.vercel.app`). Polled to `READY`, confirmed via
    `vercel inspect --logs` it genuinely cloned `Commit: ff571e4` (not stale), `✓ Compiled successfully`,
    `Finished TypeScript`, and the route list includes `├ ƒ /api/v1/orgs/[orgSlug]/partitions/[id]`.
    `/api/health` → 200 `database: "connected"`. Ran
    `PLAYWRIGHT_BASE_URL=<preview> npx playwright test stage18.spec.ts`: **all 10 tests passed** (28.8s) —
    the 7 pre-existing Room tests plus the 3 new Piece 2 tests.
  - **Manual verification — same constraint as every prior piece**: no browser/Playwright-with-UI tool
    was available in this session for a real click-through against `design-step-poc.html` side by side.
    What's verified: the new API contract (tenancy, cross-tenant reference rejection, `design`
    round-trip + derived `widthMm`) via the new E2E, plus `tsc`/`lint`. **Not verified this pass**: the
    actual Configure-mode click interactions (panel select/add/remove/split, door placement + height
    drag, edge-profile assignment, Saved-Components-rail clicks) — these are pure client-side React state
    changes with no server artifact to grep for via curl, same limitation Piece 1 stated. Per GATE A, the
    full browser-based visual side-by-side against the mockup is deferred to `test.easeetool.com`
    post-merge — stating this plainly, not approximating further.
  - No BLOCKED items. Carried-forward concerns: same `BETTER_AUTH_URL`/`crossSubDomainCookies` preview
    login issue as every prior piece (worked around in the test harness, not a product bug this piece
    introduced or can fix); the interactive Configure-mode click paths need a real browser pass at
    `engineering:test`.
