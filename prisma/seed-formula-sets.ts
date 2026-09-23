/**
 * Formula-set seeding — Stage 23 Batch 2.
 *
 * Reads the JSON documents in prisma/formula-sets/ and upserts each on (name, version) into
 * FormulaSet. Immutability rule (design-docs/04-data-model.md — FormulaSet, and stage-23.md
 * decision #1): a given (name, version) is never updated in place once it exists — a change to
 * the body ships as a new version row. This seed enforces that: it CREATES a missing (name,
 * version), and for one that already exists it only *verifies* the stored body still matches the
 * JSON file (by a structural hash) — logging and skipping rather than writing on any mismatch.
 *
 * Called from prisma/seed.ts's main(); also usable standalone for a one-off reseed.
 */
import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "../app/generated/prisma/client";
import glassPartitionStandardV1 from "./formula-sets/glass-partition-standard-v1.json";
import cloisonsFormulaSetV1 from "./formula-sets/cloisons-formula-set-v1.json";
import { validateFormulaSetBody } from "../lib/formula-set/validate";

export interface FormulaSetDoc {
  name: string;
  version: number;
  body: unknown;
}

/** Deterministic hash of a JSON-serializable value (key order independent) — used for the
 *  create-only immutability check below, not for anything security-sensitive. */
export function stableHash(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, normalize(val)]),
      );
    }
    return v;
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

/** The formula-set documents this seed knows about. Add a new entry here when a new
 *  version/name is authored under prisma/formula-sets/. */
export function loadFormulaSetDocs(): FormulaSetDoc[] {
  return [
    {
      name: "glass-partition-standard",
      version: 1,
      // NOTE is documentation only — stripped before storage so `body` is exactly the engine's
      // consumable shape ({ slots, formulas }).
      body: { slots: glassPartitionStandardV1.slots, formulas: glassPartitionStandardV1.formulas },
    },
    {
      name: "cloisons_formula_set",
      version: 1,
      // NOTE stripped — body is the engine's consumable shape ({ schemaVersion, slots, formulas }).
      body: {
        schemaVersion: 2,
        slots: cloisonsFormulaSetV1.slots,
        formulas: cloisonsFormulaSetV1.formulas,
      },
    },
  ];
}

/** The active set for a name is its HIGHEST version — same rule as createOrganizationWithDefaults()
 *  and the backfill (orderBy version desc), independent of doc array order. */
function setIfHigher(
  byName: Map<string, { id: string; name: string; version: number }>,
  row: { id: string; name: string; version: number },
): void {
  const cur = byName.get(row.name);
  if (!cur || row.version > cur.version) byName.set(row.name, row);
}

/**
 * Upserts every known formula-set doc: creates a missing (name, version); for an existing row,
 * verifies the body hash matches and logs+skips (never writes) on a mismatch — see the immutability
 * rule above. Returns the created/existing FormulaSet rows keyed by name, for callers (prisma/seed.ts)
 * that need the id to set Organization.activeFormulaSetId.
 */
export async function seedFormulaSets(
  prisma: PrismaClient,
): Promise<Map<string, { id: string; name: string; version: number }>> {
  const docs = loadFormulaSetDocs();
  const byName = new Map<string, { id: string; name: string; version: number }>();

  for (const doc of docs) {
    const existing = await prisma.formulaSet.findUnique({
      where: { name_version: { name: doc.name, version: doc.version } },
      select: { id: true, name: true, version: true, body: true },
    });

    if (existing) {
      const existingHash = stableHash(existing.body);
      const docHash = stableHash(doc.body);
      if (existingHash !== docHash) {
        console.warn(
          `  FormulaSet ${doc.name}@${doc.version} already exists with a DIFFERENT body — ` +
            "immutable per version, leaving it untouched. Ship a new version instead of editing this one.",
        );
      }
      setIfHigher(byName, { id: existing.id, name: existing.name, version: existing.version });
      continue;
    }

    // Validate before storing — aborts the entire seed on failure so a bad transcription
    // is caught immediately rather than silently stored as an unusable formula set.
    const validation = validateFormulaSetBody(doc.body);
    if (!validation.ok) {
      throw new Error(
        `FormulaSet ${doc.name}@${doc.version} failed validation:\n` +
          validation.errors.join("\n"),
      );
    }

    const created = await prisma.formulaSet.create({
      data: {
        name: doc.name,
        version: doc.version,
        body: doc.body as Prisma.InputJsonValue,
        publishedAt: new Date(),
      },
      select: { id: true, name: true, version: true },
    });
    console.log(`  Created FormulaSet ${created.name}@${created.version}`);
    setIfHigher(byName, created);
  }

  return byName;
}
