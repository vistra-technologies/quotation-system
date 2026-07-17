"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import {
  createComponentType as dalCreate,
  updateComponentType as dalUpdate,
} from "@/lib/data/components";
import type { FieldEntry } from "@/lib/data/components";
import { requireSession } from "@/lib/data/session";

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function getSessionWithManageFeatures(orgSlug: string) {
  const session = await requireSession(orgSlug);
  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      throw new Error("Forbidden: missing MANAGE_FEATURES permission");
    }
    throw e;
  }
  return session;
}

/**
 * Parse the serialised fieldsSchema JSON string from FormData.
 * Returns an empty array on any parse failure — never throws.
 * Validates: 4 valid types; options must be a non-empty array for radio/dropdown.
 */
function parseFieldsSchema(raw: string | null): FieldEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
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
          core: Boolean(obj.core),
        };
        if (optionRequiredTypes.has(type)) {
          const opts = Array.isArray(obj.options)
            ? (obj.options as unknown[]).map(String).filter(Boolean)
            : [];
          // Drop fields where options are required but empty
          if (opts.length === 0) return null;
          entry.options = opts;
        }
        if (obj.hint) {
          entry.hint = String(obj.hint);
        }
        return entry;
      })
      .filter((x): x is FieldEntry => x !== null);
  } catch {
    return [];
  }
}

// ─── Server actions ───────────────────────────────────────────────────────────

/**
 * Create a new ComponentType scoped to the session org.
 * Gate: MANAGE_FEATURES.
 * On success, revalidates the list and redirects to the new type's edit page.
 */
export async function createComponentType(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const session = await getSessionWithManageFeatures(orgSlug ?? "");

  const code = (formData.get("code") as string | null)?.trim().toUpperCase();
  const name = (formData.get("name") as string | null)?.trim();
  const category = ((formData.get("category") as string | null) ?? "").trim();
  const fieldsSchema = parseFieldsSchema(formData.get("fieldsSchema") as string | null);

  if (!code) throw new Error("Code is required");
  if (!name) throw new Error("Name is required");
  if (!category) throw new Error("Category is required");

  const created = await dalCreate(session, { code, name, category, fieldsSchema });

  revalidatePath(`/${orgSlug}/admin/components`);
  redirect(`/${orgSlug}/admin/components/${created.id}`);
}

/**
 * Update an existing ComponentType's name, fieldsSchema, and active flag.
 * Gate: MANAGE_FEATURES.
 * Tenancy guard: delegated to lib/data/components.ts updateComponentType.
 */
export async function updateComponentType(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const typeId = formData.get("typeId") as string | null;
  const session = await getSessionWithManageFeatures(orgSlug ?? "");

  if (!typeId) throw new Error("typeId is required");

  const name = (formData.get("name") as string | null)?.trim();
  const category = ((formData.get("category") as string | null) ?? "").trim();
  const fieldsSchema = parseFieldsSchema(formData.get("fieldsSchema") as string | null);
  const active = formData.get("active") === "true";

  if (!name) throw new Error("Name is required");
  if (!category) throw new Error("Category is required");

  await dalUpdate(session, typeId, { name, category, fieldsSchema, active });

  revalidatePath(`/${orgSlug}/admin/components`);
  revalidatePath(`/${orgSlug}/admin/components/${typeId}`);
  redirect(`/${orgSlug}/admin/components/${typeId}`);
}
