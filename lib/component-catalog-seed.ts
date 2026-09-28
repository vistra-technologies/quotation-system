/**
 * Shared starter ComponentType catalog definition.
 *
 * This module is imported by two callers:
 *   1. prisma/seed.ts  — idempotent dev/test seed (upsert loop over existing orgs)
 *   2. lib/data/superadmin/orgs.ts — createOrganizationWithDefaults() (plain create,
 *      runs once at org creation time, new orgs only)
 *
 * Having a single source of truth here prevents seed data and production org-creation
 * data from drifting apart.
 *
 * Stage 17 item 5b.
 *
 * Stage 20 Batch 1: split field *shape* from field *values*.
 *   - fieldsSchema now carries shape only (key/label/type/required/basic/hint + dependsOn wiring).
 *     options arrays are gone — they live in COMPONENT_TYPE_ORG_CONFIG_DEFS below.
 *   - COMPONENT_TYPE_ORG_CONFIG_DEFS is a new export: the starter option values per ComponentType
 *     code, written into a ComponentTypeOrgConfig row at org-creation time (and upserted by seed).
 *
 * Stage 23 Batch 2 (D-34): the placeholder 3-type catalog (GLASS/DOOR/PROFILE_STOP with invented
 * fields) is REPLACED with the real `cloisons` two-type vocabulary (GLASS, DOOR — no PROFILE_STOP),
 * reconciled against the dev DB's `cloisons` org. This is what the seeded FormulaSet v1's
 * `summaryParams` name (prisma/formula-sets/glass-partition-standard-v1.json) — the two land
 * together so the set's referenced keys are always real fieldsSchema keys.
 *
 * IMPORTANT — re-seeding OVERWRITES existing orgs' GLASS and DOOR (D-34, amended): prisma/seed.ts
 * upserts by (organizationId, code) and rewrites both `fieldsSchema` AND
 * `ComponentTypeOrgConfig.fieldOptionsConfig` for the codes listed below, so schema and config stay
 * consistent. Org-authored option values on those two types are replaced with the defaults below.
 * The seed still deletes nothing: an org's PROFILE_STOP type (and its config) and any other type
 * not listed below are left untouched.
 */

/** The ComponentCategory name created alongside these types. */
export const SEEDED_CATALOG_CATEGORY_NAME = "Glass Partitions";

/**
 * Thrown by both DAL update paths (lib/data/superadmin/component-types.ts and
 * lib/data/components.ts) when a `code` patch would rename one of the seeded
 * codes below. Routes catch this and map it to a 400.
 *
 * Stage 20 Batch 7.
 */
export class ReservedComponentTypeCodeError extends Error {}

/**
 * Starter ComponentType field-schema definitions for every newly-created org.
 *
 * Stage 20: fieldsSchema carries shape ONLY — no options values.
 * Options values live in COMPONENT_TYPE_ORG_CONFIG_DEFS.
 *
 * fieldsSchema uses the Stage 6 FieldEntry shape (extended Stage 20):
 *   type:      "field" | "radio" | "dropdown" | "checkbox"
 *   dependsOn: (Stage 20) key of an earlier dropdown/radio field this one depends on
 *   hint:      optional helper text shown below the input
 *   basic:     true = Basic section, false = Advanced section (shown behind Configure button)
 *
 * Stage 23 Batch 2 (D-34): the real `cloisons` catalog — two types, no PROFILE_STOP (D-35).
 * Every key referenced by the seeded FormulaSet's summaryParams (glassType, thickness, category,
 * doorType) is `required: true` here — stage-23.md's "Are summary keys required:true?" ruling
 * requires the *shipped* starter configuration to never produce a blank summary column, even
 * though the platform itself only demands presence (checked in tests/unit/formula-set-document.test.ts).
 */
export const COMPONENT_TYPE_DEFS: {
  code: string;
  name: string;
  fieldsSchema: {
    key: string;
    label: string;
    type: string;
    dependsOn?: string;
    hint?: string;
    required: boolean;
    basic: boolean;
  }[];
}[] = [
  {
    code: "GLASS",
    name: "Partition",
    fieldsSchema: [
      // Basic fields
      {
        key: "category",
        label: "Category",
        type: "dropdown",
        required: true,
        basic: true,
      },
      {
        key: "glassType",
        label: "Glass Type",
        type: "dropdown",
        dependsOn: "category",
        required: true,
        basic: true,
      },
      {
        key: "thickness",
        label: "Thickness (mm)",
        type: "dropdown",
        dependsOn: "glassType",
        hint: "Glass thickness in millimetres",
        required: true,
        basic: true,
      },
      // Advanced fields — profiles + connector/gasket/wedge codes (Stage 24 Batch 3).
      // Profiles were required: false in Stage 23 D-35 (deliberately unbilled). Now required: true
      // so the MISSING_PARAM gate fires before the formula engine instead of at it.
      {
        key: "u_profile",
        label: "U Profile",
        type: "dropdown",
        dependsOn: "glassType",
        required: true,
        basic: false,
      },
      {
        key: "i_profile",
        label: "I Profile",
        type: "dropdown",
        dependsOn: "glassType",
        required: true,
        basic: false,
      },
      {
        key: "l_profile",
        label: "L Profile",
        type: "dropdown",
        dependsOn: "glassType",
        required: true,
        basic: false,
      },
      {
        key: "acousticGasketCode",
        label: "Acoustic Gasket",
        type: "dropdown",
        dependsOn: "glassType",
        required: true,
        basic: false,
      },
      {
        key: "whiteSealCode",
        label: "White Seal",
        type: "dropdown",
        dependsOn: "glassType",
        required: true,
        basic: false,
      },
      {
        key: "woodWedgeCode",
        label: "Wood Wedge",
        type: "dropdown",
        dependsOn: "glassType",
        required: true,
        basic: false,
      },
      {
        key: "lConnectorCode",
        label: "L Connector",
        type: "dropdown",
        dependsOn: "glassType",
        required: true,
        basic: false,
      },
      {
        key: "degreeConnectorCode",
        label: "Degree Connector",
        type: "dropdown",
        dependsOn: "glassType",
        required: true,
        basic: false,
      },
      {
        key: "doorConnectorCode",
        label: "Door Connector",
        type: "dropdown",
        dependsOn: "glassType",
        required: true,
        basic: false,
      },
      {
        key: "straightConnectorCode",
        label: "Straight Connector",
        type: "dropdown",
        dependsOn: "glassType",
        required: true,
        basic: false,
      },
    ],
  },
  {
    code: "DOOR",
    name: "Door",
    fieldsSchema: [
      // Basic fields
      {
        key: "category",
        label: "Category",
        type: "dropdown",
        required: true,
        basic: true,
      },
      {
        key: "doorType",
        label: "Door Type",
        type: "dropdown",
        dependsOn: "category",
        required: true,
        basic: true,
      },
      // Advanced fields — condition flags + material-code fields (Stage 24 Batch 3).
      // All required: true per door.md's explicit ruling (D-2 in plan-b3.md): even condition-gated
      // code fields are required so the Selection form blocks submission before the engine sees a blank.
      {
        key: "hasFrame",
        label: "Has Frame",
        type: "dropdown",
        dependsOn: "doorType",
        required: true,
        basic: false,
      },
      {
        key: "hasLeaf",
        label: "Has Leaf",
        type: "dropdown",
        dependsOn: "doorType",
        required: true,
        basic: false,
      },
      {
        key: "frameCode",
        label: "Frame Profile Code",
        type: "dropdown",
        dependsOn: "doorType",
        required: true,
        basic: false,
      },
      {
        key: "leafCode",
        label: "Leaf Profile Code",
        type: "dropdown",
        dependsOn: "doorType",
        required: true,
        basic: false,
      },
      {
        key: "cornerConnBigCode",
        label: "Corner Connector (Big) Code",
        type: "dropdown",
        dependsOn: "doorType",
        required: true,
        basic: false,
      },
      {
        key: "cornerConnSmallFrameCode",
        label: "Corner Connector (Small, Frame) Code",
        type: "dropdown",
        dependsOn: "doorType",
        required: true,
        basic: false,
      },
      {
        key: "cornerConnSmallLeafCode",
        label: "Corner Connector (Small, Leaf) Code",
        type: "dropdown",
        dependsOn: "doorType",
        required: true,
        basic: false,
      },
      {
        key: "lAngleCode",
        label: "L Angle Code",
        type: "dropdown",
        dependsOn: "doorType",
        required: true,
        basic: false,
      },
      {
        key: "hingeCode",
        label: "Hinge Code",
        type: "dropdown",
        dependsOn: "doorType",
        required: true,
        basic: false,
      },
      {
        key: "rubber25mmCode",
        label: "2.5mm Rubber Strip Code",
        type: "dropdown",
        dependsOn: "doorType",
        required: true,
        basic: false,
      },
      {
        key: "frameBumperGasketCode",
        label: "Frame Bumper Gasket Code",
        type: "dropdown",
        dependsOn: "doorType",
        required: true,
        basic: false,
      },
      {
        key: "frameBackGasketCode",
        label: "Frame Back Gasket Code",
        type: "dropdown",
        dependsOn: "doorType",
        required: true,
        basic: false,
      },
      {
        key: "leafGlassGasket1Code",
        label: "Leaf Glass Gasket 1 Code",
        type: "dropdown",
        dependsOn: "doorType",
        required: true,
        basic: false,
      },
      {
        key: "leafGlassGasket2Code",
        label: "Leaf Glass Gasket 2 Code",
        type: "dropdown",
        dependsOn: "doorType",
        required: true,
        basic: false,
      },
    ],
  },
];

/**
 * The seeded codes above, derived (not hand-duplicated) for both DAL update paths to
 * check `code` patches against. These stay locked because two display-only lookups are
 * hard-coded to specific literals (`saved-components-rail.tsx`'s design-canvas
 * grouping, `component-icons.tsx`'s icon lookup) and org-creation seed-matching keys off
 * them — see design-docs/04-data-model.md's Stage 20 addendum.
 *
 * Stage 20 Batch 7.
 *
 * Stage 23 Batch 2 (D-34): shrinks from {GLASS, DOOR, PROFILE_STOP} to {GLASS, DOOR} — the swap
 * drops PROFILE_STOP from the *starter* defs only. A side effect (accepted, see stage-23.md's
 * blast-radius table): PROFILE_STOP becomes code-editable/deletable in orgs that still have it,
 * since it's no longer "reserved". That's fine — the real protection is the Batch 6 formula-set
 * guard, which blocks by *slot* (whether a set actually references the type), the correct
 * criterion, not by a hardcoded reserved-code list.
 */
export const RESERVED_COMPONENT_TYPE_CODES: ReadonlySet<string> = new Set(
  COMPONENT_TYPE_DEFS.map((d) => d.code),
);

/**
 * Starter option values per ComponentType code.
 *
 * Stage 20 Batch 1: these values were previously inline in COMPONENT_TYPE_DEFS as
 * `options` arrays. They now live here and are written into ComponentTypeOrgConfig at
 * org-creation time (and upserted by prisma/seed.ts for existing orgs).
 *
 * Shape: fieldOptionsConfig matches ComponentTypeOrgConfig.fieldOptionsConfig —
 *   { [fieldKey]: { options: string[] } }         — flat field (no dependsOn)
 *   { [fieldKey]: { valueMap: Record<parentValue, string[]> } } — dependent field
 *
 * Stage 23 Batch 2 (D-34): the real `cloisons` value chains — category -> glassType -> thickness
 * on GLASS (plus glassType -> u_profile/i_profile/l_profile), and category -> doorType on DOOR.
 * `glassType` values are product codes (ID1, NT2, TST1…), not colours — Stage 24 renders a label
 * like "ID1 · 12mm". `thickness` values are numeric-looking strings carried verbatim (no
 * coercion this stage — decision 11 is deferred to Stage 25).
 */
export const COMPONENT_TYPE_ORG_CONFIG_DEFS: {
  code: string;
  fieldOptionsConfig: Record<string, { options: string[] } | { valueMap: Record<string, string[]> }>;
}[] = [
  {
    code: "GLASS",
    fieldOptionsConfig: {
      category: { options: ["Single", "Glazed", "Double Glaze"] },
      glassType: {
        valueMap: {
          Single: ["ID1", "ID6"],
          Glazed: ["NT2"],
          "Double Glaze": ["TST1", "TST2"],
        },
      },
      thickness: {
        valueMap: {
          ID1: ["12", "12.76"],
          ID6: ["10", "14.2"],
          NT2: ["15.3", "15.2"],
          TST1: ["12"],
          TST2: ["13"],
        },
      },
      u_profile: {
        valueMap: {
          ID1: ["I LUF-01"],
          ID6: ["I LUF-01"],
          NT2: ["I LUF-01"],
          TST1: ["I LUF-01"],
          TST2: ["I LUF-01"],
        },
      },
      i_profile: {
        valueMap: {
          ID1: ["I10 PDL"],
          ID6: ["I10 PDL"],
          NT2: ["I10 PDL"],
          TST1: ["I10 PDL"],
          TST2: ["I10 PDL"],
        },
      },
      l_profile: {
        valueMap: {
          ID1: ["I LUO-01"],
          ID6: ["I LUO-01"],
          NT2: ["I LUO-01"],
          TST1: ["I LUO-01"],
          TST2: ["I LUO-01"],
        },
      },
      // Stage 24 Batch 3 connector/gasket/wedge code fields. Corrected 2026-09-28 (human
      // review against the live SuperAdmin editor): these actually depend on glassType, not
      // independent as first shipped — same code for every glassType value, since these
      // materials don't vary by glass type for cloisons, but the wiring itself does matter
      // (the Catalog page's cascade-completeness gate treats an unwired field as always
      // "complete", masking that it should track glassType additions).
      acousticGasketCode: {
        valueMap: { ID1: ["GLASS-ACGSK-01"], ID6: ["GLASS-ACGSK-01"], NT2: ["GLASS-ACGSK-01"], TST1: ["GLASS-ACGSK-01"], TST2: ["GLASS-ACGSK-01"] },
      },
      whiteSealCode: {
        valueMap: { ID1: ["GLASS-WSEAL-01"], ID6: ["GLASS-WSEAL-01"], NT2: ["GLASS-WSEAL-01"], TST1: ["GLASS-WSEAL-01"], TST2: ["GLASS-WSEAL-01"] },
      },
      woodWedgeCode: {
        valueMap: { ID1: ["GLASS-WWDG-01"], ID6: ["GLASS-WWDG-01"], NT2: ["GLASS-WWDG-01"], TST1: ["GLASS-WWDG-01"], TST2: ["GLASS-WWDG-01"] },
      },
      lConnectorCode: {
        valueMap: { ID1: ["GLASS-LCON-01"], ID6: ["GLASS-LCON-01"], NT2: ["GLASS-LCON-01"], TST1: ["GLASS-LCON-01"], TST2: ["GLASS-LCON-01"] },
      },
      degreeConnectorCode: {
        valueMap: { ID1: ["GLASS-DCON-01"], ID6: ["GLASS-DCON-01"], NT2: ["GLASS-DCON-01"], TST1: ["GLASS-DCON-01"], TST2: ["GLASS-DCON-01"] },
      },
      doorConnectorCode: {
        valueMap: { ID1: ["GLASS-DRCON-01"], ID6: ["GLASS-DRCON-01"], NT2: ["GLASS-DRCON-01"], TST1: ["GLASS-DRCON-01"], TST2: ["GLASS-DRCON-01"] },
      },
      straightConnectorCode: {
        valueMap: { ID1: ["GLASS-STCON-01"], ID6: ["GLASS-STCON-01"], NT2: ["GLASS-STCON-01"], TST1: ["GLASS-STCON-01"], TST2: ["GLASS-STCON-01"] },
      },
    },
  },
  {
    code: "DOOR",
    fieldOptionsConfig: {
      category: { options: ["Single", "Double"] },
      doorType: {
        valueMap: {
          Single: ["Simple Glass", "Frameless Glass"],
          Double: ["Simple Glass", "Frameless Glazed"],
        },
      },
      // Stage 24 Batch 3 condition flags + material-code fields. Corrected 2026-09-28 (human
      // review against the live SuperAdmin editor): these actually depend on doorType, not
      // independent as first shipped — same code for every doorType value ("Simple Glass",
      // "Frameless Glass", "Frameless Glazed", the distinct union across doorType's own
      // category-keyed valueMap below), but the wiring itself matters for the same reason
      // noted on GLASS above.
      hasFrame: {
        valueMap: { "Simple Glass": ["Yes", "No"], "Frameless Glass": ["Yes", "No"], "Frameless Glazed": ["Yes", "No"] },
      },
      hasLeaf: {
        valueMap: { "Simple Glass": ["Yes", "No"], "Frameless Glass": ["Yes", "No"], "Frameless Glazed": ["Yes", "No"] },
      },
      frameCode: {
        valueMap: { "Simple Glass": ["DOOR-FRAME-01"], "Frameless Glass": ["DOOR-FRAME-01"], "Frameless Glazed": ["DOOR-FRAME-01"] },
      },
      leafCode: {
        valueMap: { "Simple Glass": ["DOOR-LEAF-01"], "Frameless Glass": ["DOOR-LEAF-01"], "Frameless Glazed": ["DOOR-LEAF-01"] },
      },
      cornerConnBigCode: {
        valueMap: { "Simple Glass": ["DOOR-CCB-01"], "Frameless Glass": ["DOOR-CCB-01"], "Frameless Glazed": ["DOOR-CCB-01"] },
      },
      cornerConnSmallFrameCode: {
        valueMap: { "Simple Glass": ["DOOR-CCSF-01"], "Frameless Glass": ["DOOR-CCSF-01"], "Frameless Glazed": ["DOOR-CCSF-01"] },
      },
      cornerConnSmallLeafCode: {
        valueMap: { "Simple Glass": ["DOOR-CCSL-01"], "Frameless Glass": ["DOOR-CCSL-01"], "Frameless Glazed": ["DOOR-CCSL-01"] },
      },
      lAngleCode: {
        valueMap: { "Simple Glass": ["DOOR-LANG-01"], "Frameless Glass": ["DOOR-LANG-01"], "Frameless Glazed": ["DOOR-LANG-01"] },
      },
      hingeCode: {
        valueMap: { "Simple Glass": ["DOOR-HING-01"], "Frameless Glass": ["DOOR-HING-01"], "Frameless Glazed": ["DOOR-HING-01"] },
      },
      rubber25mmCode: {
        valueMap: { "Simple Glass": ["DOOR-RUB25-01"], "Frameless Glass": ["DOOR-RUB25-01"], "Frameless Glazed": ["DOOR-RUB25-01"] },
      },
      frameBumperGasketCode: {
        valueMap: { "Simple Glass": ["DOOR-FBGSK-01"], "Frameless Glass": ["DOOR-FBGSK-01"], "Frameless Glazed": ["DOOR-FBGSK-01"] },
      },
      frameBackGasketCode: {
        valueMap: { "Simple Glass": ["DOOR-FBKGSK-01"], "Frameless Glass": ["DOOR-FBKGSK-01"], "Frameless Glazed": ["DOOR-FBKGSK-01"] },
      },
      leafGlassGasket1Code: {
        valueMap: { "Simple Glass": ["DOOR-LGG1-01"], "Frameless Glass": ["DOOR-LGG1-01"], "Frameless Glazed": ["DOOR-LGG1-01"] },
      },
      leafGlassGasket2Code: {
        valueMap: { "Simple Glass": ["DOOR-LGG2-01"], "Frameless Glass": ["DOOR-LGG2-01"], "Frameless Glazed": ["DOOR-LGG2-01"] },
      },
    },
  },
];
