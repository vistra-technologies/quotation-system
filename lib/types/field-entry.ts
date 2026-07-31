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
  options?: string[];
  hint?: string;
};
