/**
 * One-time v1 -> v2 `Partition.design` migration (Stage 22 Batch 2).
 *
 *   v1: design.panels[]                      (one flat panel per pane; a door panel carries `door`)
 *   v2: design.schemaVersion 2 + sections[].cells[]
 *
 * The conversion itself is NOT implemented here: it reuses `parseStoredDesign` + `panelsToV2` from
 * `lib/partition-design.ts` (the same code the Design page saves with), so the migrated shape is exactly
 * what the app would have written. Door/transom rule (Stage 22 D-4): a door shorter than the wall becomes
 * two cells [transom glass, door]; transom glass = panel selectionId -> design.defaults.glassSelectionId
 * -> null. A null transom selection is valid v2 (written as null, never an error).
 *
 * Safety:
 *   - DRY RUN IS THE DEFAULT. Rows are written only when `--write` is passed; `--dry-run` and npm's own
 *     `--dry-run` config (npm swallows it without forwarding) always win. npm also swallows unknown flags
 *     placed before `--`, so `--write` must come after it.
 *   - Fail-closed destination guard (prisma/db-target-guard.ts, D-19): DATABASE_URL must resolve to the dev
 *     Neon endpoint (ep-dark-term-ai0ufj4k) by default. Production only with the explicit opt-in
 *     EXPECT_ENDPOINT=ep-little-paper-aipm0o0i set in the operator's own shell AND equal to the URL's endpoint;
 *     anything else aborts. Production runs print "*** PRODUCTION ***". Only with human go-ahead.
 *   - Env precedence matches Next: process env > .env.local > .env. The target endpoint is printed first.
 *   - Each write is conditional on the row still equalling what was read (updateMany); a row edited
 *     mid-run is reported as skipped (concurrent edit) and picked up by a re-run.
 *   - Idempotent: rows already v2 are skipped without modification; malformed rows, rows failing the
 *     width-sum / per-section height-sum invariants, and v1 geometry inconsistent with the partition
 *     are logged with their id and never written.
 *
 * Usage (from quotation-system/):
 *   npm run migrate:design-v2                    # dry run (default): report only
 *   npm run migrate:design-v2 -- --write         # real run (dev DB only, with human go-ahead)
 *
 * Cell ids: converted cells get ids derived from the v1 panel id (`<panelId>-c` / `-t` / `-d`, the same
 * scheme the Design page's save uses). Ids only need to be unique within one document.
 */
import dotenv from "dotenv";
import { describeTarget, endpointOf, enforceDbTarget } from "./db-target-guard";
import type { Prisma } from "../app/generated/prisma/client";
import {
  PartitionDesignError,
  assertSectionHeights,
  panelsToV2,
  parseStoredDesign,
  sumSectionWidths,
  type DesignSectionV2,
} from "../lib/partition-design";

// Same precedence as Next: real env > .env.local > .env (dotenv never overrides an already-set var).
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

// Destination guard: dev endpoint by default; production only via explicit EXPECT_ENDPOINT opt-in (D-19).
export { endpointOf };

export type Classification =
  | { kind: "v2" }
  | { kind: "v1" }
  | { kind: "no-geometry" } // e.g. only `stops` — nothing to convert
  | { kind: "malformed"; reason: string };

export function classifyDesign(raw: unknown): Classification {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { kind: "malformed", reason: "design is not a JSON object" };
  }
  const d = raw as Record<string, unknown>;
  const hasPanels = d.panels !== undefined;
  const hasSections = d.sections !== undefined;
  const hasVersion = d.schemaVersion !== undefined;
  if (hasSections && !hasPanels && d.schemaVersion === 2 && Array.isArray(d.sections)) {
    return { kind: "v2" };
  }
  if (hasPanels && !hasSections && !hasVersion && Array.isArray(d.panels)) return { kind: "v1" };
  if (!hasPanels && !hasSections && !hasVersion) return { kind: "no-geometry" };
  return { kind: "malformed", reason: "neither a v1 (panels) nor a v2 (sections, schemaVersion 2) shape" };
}

export interface ConvertResult {
  design: Record<string, unknown>;
  /** Transom cells written with a null selectionId (Stage 23's Submit Design check surfaces these). */
  nullTransomCells: number;
}

/**
 * Pure v1 -> v2 conversion + validation. Throws PartitionDesignError (malformed panel shape or a failed
 * invariant); never guesses. Exported for B7's pure-logic checks.
 */
export function convertV1ToV2(
  rawDesign: Record<string, unknown>,
  partition: { widthMm: number; heightMm: number },
): ConvertResult {
  const view = parseStoredDesign(rawDesign, {
    widthMm: partition.widthMm,
    heightMm: partition.heightMm,
    isDoorSelection: () => false, // unused for v1 (panels are mapped 1:1)
  });
  const panels = view.panels ?? [];
  const seen = new Set<string>();
  panels.forEach((p, i) => {
    if (!p || typeof p !== "object") throw new PartitionDesignError(`panels[${i}] is not an object`);
    if (typeof p.id !== "string" || !p.id) throw new PartitionDesignError(`panels[${i}].id is missing`);
    if (seen.has(p.id)) throw new PartitionDesignError(`panels[${i}].id "${p.id}" is duplicated`);
    seen.add(p.id);
    if (p.type !== "glass" && p.type !== "door") {
      throw new PartitionDesignError(`panels[${i}].type must be "glass" or "door"`);
    }
    if (typeof p.widthMm !== "number" || !Number.isInteger(p.widthMm) || p.widthMm <= 0) {
      throw new PartitionDesignError(`panels[${i}].widthMm must be a positive integer`);
    }
    if (p.type === "door" && !p.door) {
      throw new PartitionDesignError(`panels[${i}] is a door panel with no door`);
    }
    // Anomalous v1 geometry is a validation failure (task step 6), not something to repair silently.
    if (p.type === "glass" && p.heightMm !== partition.heightMm) {
      throw new PartitionDesignError(
        `panels[${i}].heightMm ${p.heightMm}mm != Partition.heightMm ${partition.heightMm}mm`,
      );
    }
    if (p.type === "door" && p.door) {
      if (typeof p.door.selectionId !== "string" || !p.door.selectionId) {
        throw new PartitionDesignError(`panels[${i}].door.selectionId is missing`);
      }
      const h = p.door.outerFrame?.h;
      if (h !== undefined && (typeof h !== "number" || !(h > 0) || h > partition.heightMm)) {
        throw new PartitionDesignError(
          `panels[${i}].door.outerFrame.h ${String(h)} is not within 1..${partition.heightMm}mm (wall height)`,
        );
      }
    }
  });

  const converted = panelsToV2(view, partition.heightMm);
  const sections: DesignSectionV2[] = converted.sections ?? [];

  // Validate before write: sum(section widths) == Partition.widthMm; per section sum(cell heights) == height.
  const width = sumSectionWidths(sections);
  if (width !== partition.widthMm) {
    throw new PartitionDesignError(
      `section widths sum to ${width}mm but Partition.widthMm is ${partition.widthMm}mm`,
    );
  }
  assertSectionHeights(sections, partition.heightMm);

  const nullTransomCells = sections.filter(
    (s) => s.cells.length === 2 && s.cells[0].selectionId === null,
  ).length;

  // Any top-level key beyond panels/geometry (none expected) is carried over rather than silently lost;
  // defaults/measurements/distribution/stops come through panelsToV2 verbatim.
  const { panels: _panels, ...rest } = rawDesign;
  void _panels;
  return { design: { ...rest, ...converted } as Record<string, unknown>, nullTransomCells };
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const target = enforceDbTarget();
  // Dry run unless --write is given; --dry-run (or npm's swallowed --dry-run config) always wins.
  const dryRun =
    !process.argv.includes("--write") ||
    process.argv.includes("--dry-run") ||
    process.env.npm_config_dry_run === "true";

  // Loaded only after the guard, so a refused run never constructs a client.
  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  console.log(describeTarget(target));
  console.log(
    dryRun
      ? "DRY RUN — nothing will be written. (Pass `-- --write` to write.)"
      : "REAL RUN (--write) — converted rows will be written.",
  );

  let total = 0;
  let converted = 0;
  let alreadyV2 = 0;
  let noGeometry = 0;
  let nullTransoms = 0;
  const failures: string[] = [];
  const malformed: string[] = [];
  const skippedConcurrent: string[] = [];
  let aborted = false;

  try {
    const rows = await prisma.partition.findMany({
      select: { id: true, widthMm: true, heightMm: true, design: true },
      orderBy: { partitionNumber: "asc" },
    });
    // Rows with no design at all are ignored (filtered here; Prisma's Json? null filter is awkward).
    const withDesign = rows.filter((r) => r.design !== null);
    total = withDesign.length;

    for (const row of withDesign) {
      const cls = classifyDesign(row.design);
      if (cls.kind === "v2") {
        alreadyV2++;
        continue;
      }
      if (cls.kind === "no-geometry") {
        noGeometry++;
        continue;
      }
      if (cls.kind === "malformed") {
        malformed.push(`${row.id}: ${cls.reason}`);
        continue;
      }
      try {
        const result = convertV1ToV2(row.design as Record<string, unknown>, row);
        if (!dryRun) {
          // Conditional write: only if the row still equals what we read (dev DB is shared with previews/test).
          const res = await prisma.partition.updateMany({
            where: { id: row.id, design: { equals: row.design as Prisma.InputJsonValue } },
            data: { design: result.design as Prisma.InputJsonValue },
          });
          if (res.count === 0) {
            skippedConcurrent.push(row.id);
            continue;
          }
        }
        converted++;
        nullTransoms += result.nullTransomCells;
      } catch (err) {
        if (err instanceof PartitionDesignError) {
          failures.push(`${row.id}: ${err.message}`);
        } else {
          aborted = true;
          throw err;
        }
      }
    }
  } finally {
    const list = (items: string[]) => (items.length ? "\n  " + items.join("\n  ") : "");
    console.log("\n──── Partition.design v1 -> v2 report ────");
    console.log(`${describeTarget(target)}${dryRun ? " (dry run)" : ""}`);
    if (aborted) console.log("!! RUN ABORTED by an unexpected error — counts below are PARTIAL. Re-run is safe (idempotent).");
    console.log(`Rows with a design:                ${total}`);
    console.log(`${dryRun ? "Would convert" : "Converted"}: ${converted}`);
    console.log(`Already v2 (skipped): ${alreadyV2}`);
    console.log(`No geometry, e.g. stops only (skipped): ${noGeometry}`);
    console.log(`Validation failures (not written): ${failures.length}${list(failures)}`);
    console.log(`Malformed (not written): ${malformed.length}${list(malformed)}`);
    console.log(`Skipped, edited concurrently (re-run to pick up): ${skippedConcurrent.length}${list(skippedConcurrent)}`);
    console.log(`Transom cells with null selectionId (valid; Stage 23 flags as incomplete): ${nullTransoms}`);
    if (failures.length || malformed.length || skippedConcurrent.length) process.exitCode = 1;
    await prisma.$disconnect();
  }
}

// Run only when executed directly (not when imported for pure-function checks).
if (process.argv[1] && /migrate-design-v1-to-v2\.[cm]?[tj]s$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
