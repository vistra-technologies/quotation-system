/**
 * Shared FieldEntry type — describes one field in a ComponentType's fieldsSchema.
 *
 * Extracted from lib/data/components.ts so that client components and server
 * actions under app/[orgSlug]/** can import this type without violating the
 * lib/data/* access ban (which restricts direct DAL imports to app/api/**).
 *
 * lib/data/components.ts re-exports this type for backward compatibility with
 * all existing API route handlers in app/api/**.
 */
export type FieldEntry = {
  key: string;
  label: string;
  type: "field" | "radio" | "dropdown" | "checkbox";
  required: boolean;
  basic: boolean;
  hint?: string;
  // Stage 20: SuperAdmin-authored wiring — the key of an earlier field in the same
  // fieldsSchema array that this dropdown/radio field's value list narrows by.
  // Only applicable to type === "dropdown" | "radio". Values live in ComponentTypeOrgConfig.
  dependsOn?: string;
  // Stage 35 S35-1: SuperAdmin-authored visibility rule. One controller (an earlier dropdown/radio
  // field); the field is visible only while the controller's value is in `in`. Allowed on any type.
  showWhen?: ShowWhen;
  // Stage 35 S35-1: dropdown/radio only; its option values must be Inventory codes. `false` is stored absent.
  inventoryLinked?: boolean;
};

/** Stage 35 S35-1: one controller, whose current value must be in `in` for the field to be visible. */
export type ShowWhen = { field: string; in: string[] };
