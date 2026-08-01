"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// ---------------------------------------------------------------------------
// createExternalCompany
// ---------------------------------------------------------------------------

export type CreateExternalCompanyState = { error: string | null };

/**
 * Create a new external company within the session's org.
 *
 * Uses the useActionState signature so the client form can surface errors
 * without crashing to an error boundary.
 *
 * Gate: MANAGE_USERS (enforced by POST /api/v1/orgs/[orgSlug]/external-companies).
 *
 * Stage 12 Batch 6: thin marshaler — FormData → internalFetch → error state or redirect.
 */
export async function createExternalCompany(
  prevState: CreateExternalCompanyState,
  formData: FormData,
): Promise<CreateExternalCompanyState> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const name = (formData.get("name") as string | null)?.trim();
  const type = formData.get("type") as string | null;

  if (!name || !type) {
    return { error: "Name and type are required" };
  }

  if (type !== "DISTRIBUTOR" && type !== "ARCHITECTURAL_FIRM") {
    return { error: "Invalid company type" };
  }

  if (!orgSlug) return { error: "Missing orgSlug" };

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/external-companies`,
    {
      method: "POST",
      body: JSON.stringify({ name, type }),
    },
  );

  if (res.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (res.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    return { error: body.error ?? "Failed to create company" };
  }

  revalidatePath(`/${orgSlug}/admin/external-companies`);
  redirect(await orgHref(orgSlug ?? "", "/admin/external-companies"), RedirectType.replace);
}
