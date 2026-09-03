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
 */

/** The ComponentCategory name created alongside these types. */
export const SEEDED_CATALOG_CATEGORY_NAME = "Glass Partitions";

/**
 * Starter ComponentType definitions for every newly-created org.
 *
 * fieldsSchema uses the Stage 6 FieldEntry shape:
 *   type: "field" | "radio" | "dropdown" | "checkbox"
 *   options: required for radio / dropdown
 *   hint: optional helper text shown below the input
 *   basic: true = Basic section, false = Advanced section (shown behind Configure button)
 */
export const COMPONENT_TYPE_DEFS: {
  code: string;
  name: string;
  fieldsSchema: {
    key: string;
    label: string;
    type: string;
    options?: string[];
    hint?: string;
    required: boolean;
    basic: boolean;
  }[];
}[] = [
  {
    code: "GLASS",
    name: "Glass",
    fieldsSchema: [
      // Basic fields
      {
        key: "thickness",
        label: "Thickness (mm)",
        type: "field",
        hint: "Glass thickness in millimetres",
        required: true,
        basic: true,
      },
      {
        key: "glassType",
        label: "Glass Type",
        type: "radio",
        options: ["Clear", "Frosted", "Tinted"],
        required: true,
        basic: true,
      },
      {
        key: "finish",
        label: "Finish",
        type: "dropdown",
        options: ["Polished", "Satin", "Matt"],
        required: false,
        basic: true,
      },
      // Advanced fields
      {
        key: "note",
        label: "Internal Note",
        type: "field",
        hint: "Internal reference note",
        required: false,
        basic: false,
      },
      {
        key: "customOrder",
        label: "Custom Order",
        type: "checkbox",
        hint: "Mark as custom order",
        required: false,
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
        key: "doorType",
        label: "Door Type",
        // Changed from "radio" to "dropdown" (Stage 17 item 5b / field-pairing decision):
        // The field-pairing layout (5d) auto-pairs consecutive field/dropdown entries into
        // 2-column rows; radio fields always render full-width alone. Changing to dropdown
        // lets doorType pair with the adjacent "width" field entry, matching the mockup.
        // See design-docs/08-decisions-and-changelog.md 2026-09-03 decision #3.
        type: "dropdown",
        options: ["Single Swing", "Double Swing", "Sliding"],
        required: true,
        basic: true,
      },
      {
        key: "width",
        label: "Width (mm)",
        type: "field",
        hint: "Width in mm",
        required: true,
        basic: true,
      },
      {
        key: "glassVariant",
        label: "Glass Variant",
        type: "dropdown",
        options: ["Standard", "Fire-Rated"],
        required: false,
        basic: true,
      },
      // Advanced fields
      {
        key: "handedness",
        label: "Handedness",
        type: "dropdown",
        options: ["Left", "Right", "Reversible"],
        required: false,
        basic: false,
      },
      {
        key: "hasCloser",
        label: "Include Door Closer",
        type: "checkbox",
        hint: "Include door closer in the configuration",
        required: false,
        basic: false,
      },
    ],
  },
  {
    code: "PROFILE_STOP",
    name: "Profile Stop",
    fieldsSchema: [
      // Basic fields
      {
        key: "profileCode",
        label: "Profile Code",
        type: "field",
        hint: "e.g. U-CH-25",
        required: true,
        basic: true,
      },
      {
        key: "material",
        label: "Material",
        type: "dropdown",
        options: ["Aluminium", "Steel", "Stainless Steel"],
        required: true,
        basic: true,
      },
      {
        key: "lengthM",
        label: "Length (m)",
        type: "field",
        hint: "Length in metres",
        required: false,
        basic: true,
      },
      // Advanced fields
      {
        key: "colour",
        label: "Colour / Finish",
        type: "field",
        hint: "RAL code or finish name",
        required: false,
        basic: false,
      },
      {
        key: "anodised",
        label: "Anodised",
        type: "checkbox",
        required: false,
        basic: false,
      },
    ],
  },
];
