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
 *   - `--dry-run`  reads and validates everything, prints the report, writes NOTHING.
 *   - Refuses to run when DATABASE_URL contains the production Neon host (ep-little-paper-aipm0o0i).
 *     NEVER run this against production.
 *   - Idempotent: rows already v2 are skipped without modification; malformed rows and rows failing the
 *     width-sum / per-section height-sum invariants are logged with their id and never written.
 *
 * Usage (from quotation-system/):
 *   npm run migrate:design-v2 -- --dry-run     # report only
 *   npm run migrate:design-v2                  # real run (dev DB only, with human go-ahead)
 *
 * Cell ids: converted cells get ids derived from the v1 panel id (`<panelId>-c` / `-t` / `-d`, the same
 * scheme the Design page's save uses). Ids only need to be unique within one document.
 */
import "dotenv/config";
import type { Prisma } from "../app/generated/prisma/client";
import {
  PartitionDesignError,
  assertSectionHeights,
  panelsToV2,
  parseStoredDesign,
  sumSectionWidths,
  type DesignSectionV2,
} from "../lib/partition-design";

const PROD_BRANCH_HOSTNAME = "ep-little-paper-aipm0o0i";

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
  if (!url) {
    console.error("ABORT: DATABASE_URL is not set.");
    process.exit(1);
  }
  if (url.includes(PROD_BRANCH_HOSTNAME)) {
    console.error("FATAL: DATABASE_URL points at the PRODUCTION Neon branch — refusing to run.");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");

  // Loaded only after the guard, so a refused run never constructs a client.
  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  console.log(dryRun ? "DRY RUN — nothing will be written." : "REAL RUN — converted rows will be written.");

  try {
    const rows = await prisma.partition.findMany({
      select: { id: true, widthMm: true, heightMm: true, design: true },
      orderBy: { partitionNumber: "asc" },
    });
    // Rows with no design at all are ignored (filtered here; Prisma's Json? null filter is awkward).
    const withDesign = rows.filter((r) => r.design !== null);

    let converted = 0;
    let alreadyV2 = 0;
    let noGeometry = 0;
    let nullTransoms = 0;
    const failures: string[] = [];
    const malformed: string[] = [];

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
          await prisma.partition.update({
            where: { id: row.id },
            data: { design: result.design as Prisma.InputJsonValue },
          });
        }
        converted++;
        nullTransoms += result.nullTransomCells;
      } catch (err) {
        if (err instanceof PartitionDesignError) {
          failures.push(`${row.id}: ${err.message}`);
        } else {
          throw err;
        }
      }
    }

    const list = (items: string[]) => (items.length ? "\n  " + items.join("\n  ") : "");
    console.log("\n──── Partition.design v1 -> v2 report ────");
    console.log(`Rows with a design:                ${withDesign.length}`);
    console.log(`${dryRun ? "Would convert" : "Converted"}: ${converted}`);
    console.log(`Already v2 (skipped): ${alreadyV2}`);
    console.log(`No geometry, e.g. stops only (skipped): ${noGeometry}`);
    console.log(`Validation failures (not written): ${failures.length}${list(failures)}`);
    console.log(`Malformed (not written): ${malformed.length}${list(malformed)}`);
    console.log(`Transom cells with null selectionId (valid; Stage 23 flags as incomplete): ${nullTransoms}`);
    if (failures.length || malformed.length) process.exitCode = 1;
  } finally {
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
