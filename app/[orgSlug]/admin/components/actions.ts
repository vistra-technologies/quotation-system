"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import type { FieldEntry } from "@/lib/types/field-entry";

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Parse the serialised fieldsSchema JSON string from FormData.
 * Returns an empty array if the raw value is absent or not valid JSON.
 * Throws a descriptive Error if a radio/dropdown field has no options — this propagates
 * to the page-level error boundary, matching the !code / !name / !category guards above.
 */
function parseFieldsSchema(raw: string | null): FieldEntry[] {
  if (!raw) return [];

  // Isolate JSON.parse errors from validation errors so that a validation throw
  // can escape and propagate to the caller (instead of being swallowed by the catch).
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  const validTypes = new Set(["field", "radio", "dropdown", "checkbox"]);
  const optionRequiredTypes = new Set(["radio", "dropdown"]);
  return (parsed as unknown[])
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const obj = item as Record<string, unknown>;
      const type = (validTypes.has(obj.type as string) ? obj.type : "field") as FieldEntry["type"];
      const entry: FieldEntry = {
        key: String(obj.key ?? ""),
        label: String(obj.label ?? ""),
        type,
        required: Boolean(obj.required),
        basic: obj.basic !== undefined ? Boolean(obj.basic) : true,
      };
      if (optionRequiredTypes.has(type)) {
        const opts = Array.isArray(obj.options)
          ? (obj.options as unknown[]).map(String).filter(Boolean)
          : [];
        if (opts.length === 0) {
          throw new Error(
            `Field "${String(obj.label ?? obj.key ?? type)}": ${type} type requires at least one option.`,
          );
        }
        entry.options = opts;
      }
      if (obj.hint) {
        entry.hint = String(obj.hint);
      }
      return entry;
    })
    .filter((x): x is FieldEntry => x !== null);
}

// ─── Server actions ───────────────────────────────────────────────────────────

/**
 * Create a new ComponentType scoped to the session org.
 * Gate: MANAGE_FEATURES (enforced by POST /api/v1/orgs/[orgSlug]/component-types).
 * On success, revalidates the list and redirects to the new type's edit page.
 *
 * Stage 12 Batch 6: thin marshaler — FormData → internalFetch → redirect or throw.
 */
export async function createComponentType(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;

  const code = (formData.get("code") as string | null)?.trim().toUpperCase();
  const name = (formData.get("name") as string | null)?.trim();
  const categoryId = ((formData.get("categoryId") as string | null) ?? "").trim();
  const fieldsSchema = parseFieldsSchema(formData.get("fieldsSchema") as string | null);

  if (!code) throw new Error("Code is required");
  if (!name) throw new Error("Name is required");
  if (!categoryId) throw new Error("Category is required");
  if (!orgSlug) throw new Error("Missing orgSlug");

  const res = await internalFetch(`/api/v1/orgs/${orgSlug}/component-types`, {
    method: "POST",
    body: JSON.stringify({ code, name, categoryId, fieldsSchema }),
  });

  if (res.status === 401) redirect(await orgHref(orgSlug, "/login"));

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? "Failed to create component type");
  }

  const { componentType } = (await res.json()) as { componentType: { id: string } };

  revalidatePath(`/${orgSlug}/admin/components`);
  redirect(`/${orgSlug}/admin/components/${componentType.id}`, RedirectType.replace);
}

/**
 * Update an existing ComponentType's name, fieldsSchema, and active flag.
 * Gate: MANAGE_FEATURES (enforced by PATCH /api/v1/orgs/[orgSlug]/component-types/[typeId]).
 *
 * Stage 12 Batch 6: thin marshaler — FormData → internalFetch → redirect or throw.
 */
export async function updateComponentType(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const typeId = formData.get("typeId") as string | null;

  if (!typeId) throw new Error("typeId is required");
  if (!orgSlug) throw new Error("Missing orgSlug");

  const name = (formData.get("name") as string | null)?.trim();
  const categoryId = ((formData.get("categoryId") as string | null) ?? "").trim();
  const fieldsSchema = parseFieldsSchema(formData.get("fieldsSchema") as string | null);
  const active = formData.get("active") === "true";

  if (!name) throw new Error("Name is required");
  if (!categoryId) throw new Error("Category is required");

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/component-types/${typeId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name, categoryId, fieldsSchema, active }),
    },
  );

  if (res.status === 401) redirect(await orgHref(orgSlug, "/login"));

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? "Failed to update component type");
  }

  revalidatePath(`/${orgSlug}/admin/components`);
  revalidatePath(`/${orgSlug}/admin/components/${typeId}`);
  redirect(await orgHref(orgSlug ?? "", `/admin/components/${typeId}`), RedirectType.replace);
}
