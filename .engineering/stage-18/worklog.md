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
