"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { withAction } from "@/lib/with-route";

// ---------------------------------------------------------------------------
// deleteInventoryItem
// ---------------------------------------------------------------------------

/**
 * Delete an inventory item from the org.
 *
 * Thin marshaler: delegates to
 * DELETE /api/v1/orgs/[orgSlug]/inventory/[itemId] via internalFetch.
 * All tenancy enforcement and business logic live in the route handler.
 *
 * Throws on error so the caller (DeleteInventoryItemButton) can surface it.
 *
 * Hotfix 2026-09-27 H-6.
 */
export const deleteInventoryItem = withAction(
  "app/[orgSlug]/admin/inventory/actions#deleteInventoryItem",
  async (formData: FormData): Promise<void> => {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const itemId = formData.get("itemId") as string | null;

  if (!itemId) throw new Error("itemId is required");

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/inventory/${itemId}`,
    { method: "DELETE" },
  );

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!res.ok) {
    let errorMessage = "An unexpected error occurred — please try again.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(errorMessage);
  }

  revalidatePath(`/${orgSlug}/admin/inventory`);
});
