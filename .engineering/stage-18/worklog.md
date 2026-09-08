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
