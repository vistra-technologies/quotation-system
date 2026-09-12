"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import type { FieldEntry } from "@/lib/types/field-entry";

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Parse the serialised fieldsSchema JSON string from FormData.
 * Returns an empty array if the raw value is absent or not valid JSON.
 *
 * Stage 20 Batch 2: no longer collects/requires `options` — SuperAdmin authors
 * field shape and `dependsOn` wiring only; option values live in the org-owned
 * `ComponentTypeOrgConfig` table. Passes `dependsOn` through as-is; the
 * earlier-field + dropdown/radio-only rule is enforced server-side by the
 * SuperAdmin API route's `validateFieldsSchema` call, whose error surfaces via
 * the `!res.ok` branch below.
 */
function parseFieldsSchema(raw: string | null): FieldEntry[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  const validTypes = new Set(["field", "radio", "dropdown", "checkbox"]);
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
      if (obj.hint) {
        entry.hint = String(obj.hint);
      }
      if (obj.dependsOn && typeof obj.dependsOn === "string") {
        entry.dependsOn = obj.dependsOn;
      }
      return entry;
    })
    .filter((x): x is FieldEntry => x !== null);
}

// ─── Server actions ───────────────────────────────────────────────────────────

/**
 * Create a new ComponentType via the SuperAdmin API route.
 * Reads orgId, code, name, categoryId, fieldsSchema from FormData.
 * On success: revalidates the controls page and redirects to ?orgId=xxx&typeId=newId.
 * On 401: redirects to /controls/login.
 *
 * Stage 19 Batch 5 — SuperAdmin ComponentType management relocated to /controls.
 */
export async function createSuperAdminComponentType(formData: FormData): Promise<void> {
  const orgId = (formData.get("orgId") as string | null)?.trim();
  const code = (formData.get("code") as string | null)?.trim().toUpperCase();
  const name = (formData.get("name") as string | null)?.trim();
  const categoryId = ((formData.get("categoryId") as string | null) ?? "").trim();
  const fieldsSchema = parseFieldsSchema(formData.get("fieldsSchema") as string | null);

  if (!orgId) throw new Error("orgId is required");
  if (!code) throw new Error("Code is required");
  if (!name) throw new Error("Name is required");
  if (!categoryId) throw new Error("Category is required");

  const res = await internalFetch("/api/v1/superadmin/component-types", {
    method: "POST",
    body: JSON.stringify({ orgId, code, name, categoryId, fieldsSchema }),
  });

  if (res.status === 401) redirect("/controls/login");

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? "Failed to create component type");
  }

  const { componentType } = (await res.json()) as { componentType: { id: string } };

  revalidatePath("/controls/component-types");
  redirect(
    `/controls/component-types?orgId=${encodeURIComponent(orgId)}&typeId=${encodeURIComponent(componentType.id)}`,
    RedirectType.replace,
  );
}

/**
 * Update an existing ComponentType via the SuperAdmin API route.
 * Reads orgId, typeId, name, categoryId, fieldsSchema, active from FormData.
 * On success: revalidates the controls page and redirects back to ?orgId=xxx.
 * On 401: redirects to /controls/login.
 *
 * Stage 19 Batch 5 — SuperAdmin ComponentType management relocated to /controls.
 */
export async function updateSuperAdminComponentType(formData: FormData): Promise<void> {
  const orgId = (formData.get("orgId") as string | null)?.trim();
  const typeId = formData.get("typeId") as string | null;

  if (!orgId) throw new Error("orgId is required");
  if (!typeId) throw new Error("typeId is required");

  // `code` is absent from FormData when the form disabled the input (reserved codes,
  // Stage 20 Batch 7) — omit it from the patch entirely rather than sending an empty string.
  const code = (formData.get("code") as string | null)?.trim().toUpperCase() || undefined;
  const name = (formData.get("name") as string | null)?.trim();
  const categoryId = ((formData.get("categoryId") as string | null) ?? "").trim();
  const fieldsSchema = parseFieldsSchema(formData.get("fieldsSchema") as string | null);
  const active = formData.get("active") === "true";

  if (!name) throw new Error("Name is required");
  if (!categoryId) throw new Error("Category is required");

  const res = await internalFetch(
    `/api/v1/superadmin/component-types/${encodeURIComponent(typeId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ orgId, ...(code ? { code } : {}), name, categoryId, fieldsSchema, active }),
    },
  );

  if (res.status === 401) redirect("/controls/login");

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? "Failed to update component type");
  }

  revalidatePath("/controls/component-types");
  redirect(
    `/controls/component-types?orgId=${encodeURIComponent(orgId)}`,
    RedirectType.replace,
  );
}

/**
 * Delete a ComponentType via the SuperAdmin API route.
 * Reads orgId and typeId from FormData.
 * On success: revalidates the controls page and redirects back to ?orgId=xxx.
 * On 401: redirects to /controls/login.
 * On 409 (type is in use): throws an error with a human-readable message.
 *
 * Stage 19 bugs-3 M1 — delete affordance for SuperAdmin Component Types.
 */
export async function deleteSuperAdminComponentType(formData: FormData): Promise<void> {
  const orgId = (formData.get("orgId") as string | null)?.trim();
  const typeId = formData.get("typeId") as string | null;

  if (!orgId) throw new Error("orgId is required");
  if (!typeId) throw new Error("typeId is required");

  const res = await internalFetch(
    `/api/v1/superadmin/component-types/${encodeURIComponent(typeId)}?orgId=${encodeURIComponent(orgId)}`,
    { method: "DELETE" },
  );

  if (res.status === 401) redirect("/controls/login");

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? "Failed to delete component type");
  }

  revalidatePath("/controls/component-types");
  redirect(
    `/controls/component-types?orgId=${encodeURIComponent(orgId)}`,
    RedirectType.replace,
  );
}
