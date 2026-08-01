"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

export type CreatePermissionState = { error: string | null };

/**
 * Create a new global Permission row.
 *
 * Permission is GLOBAL — no organizationId, no tenancy filter.
 * Gate: MANAGE_FEATURES (enforced by POST /api/v1/permissions).
 *
 * Duplicate code returns 409 from the route handler; we map it to a user-readable error.
 *
 * ⚠ Creating a Permission row grants NO capability. It only takes effect
 * once a developer adds requirePermission(session, "<code>") in code.
 *
 * Stage 12 Batch 6: thin marshaler — FormData → internalFetch → error state or redirect.
 */
export async function createPermission(
  prevState: CreatePermissionState,
  formData: FormData,
): Promise<CreatePermissionState> {
  const orgSlug = formData.get("orgSlug") as string | null;

  const code = (formData.get("code") as string | null)?.trim().toUpperCase() ?? "";
  const description = (formData.get("description") as string | null)?.trim() ?? "";

  if (!code) return { error: "Permission code is required" };
  if (!description) return { error: "Description is required" };
  if (!orgSlug) return { error: "Missing orgSlug" };

  const res = await internalFetch(`/api/v1/permissions`, {
    method: "POST",
    body: JSON.stringify({ code, description }),
  });

  if (res.status === 401) redirect(await orgHref(orgSlug, "/login"));

  if (res.status === 409) {
    return { error: `Permission code "${code}" already exists` };
  }

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    return { error: body.error ?? "Failed to create permission" };
  }

  revalidatePath(`/${orgSlug}/admin/permissions`);
  redirect(`/${orgSlug}/admin/permissions`);
}
