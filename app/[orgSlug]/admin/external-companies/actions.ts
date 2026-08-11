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
 * Stage 13 Batch 2: added country + defaultCurrency fields.
 */
export async function createExternalCompany(
  prevState: CreateExternalCompanyState,
  formData: FormData,
): Promise<CreateExternalCompanyState> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const name = (formData.get("name") as string | null)?.trim();
  const type = formData.get("type") as string | null;
  const country = formData.get("country") as string | null;
  const defaultCurrency = formData.get("defaultCurrency") as string | null;

  if (!name || !type || !country || !defaultCurrency) {
    return { error: "All fields are required" };
  }

  if (type !== "DISTRIBUTOR" && type !== "ARCHITECTURAL_FIRM") {
    return { error: "Invalid company type" };
  }

  if (country !== "INDIA" && country !== "UAE") {
    return { error: "Invalid country" };
  }

  if (
    defaultCurrency !== "INR" &&
    defaultCurrency !== "AED" &&
    defaultCurrency !== "USD"
  ) {
    return { error: "Invalid default currency" };
  }

  if (!orgSlug) return { error: "Missing orgSlug" };

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/external-companies`,
    {
      method: "POST",
      body: JSON.stringify({ name, type, country, defaultCurrency }),
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

// ---------------------------------------------------------------------------
// updateExternalCompany
// ---------------------------------------------------------------------------

export type UpdateExternalCompanyState = { error: string | null };

/**
 * Update an existing external company within the session's org.
 *
 * Gate: MANAGE_USERS (enforced by PATCH /api/v1/orgs/[orgSlug]/external-companies/[companyId]).
 *
 * Stage 13 Batch 2.
 */
export async function updateExternalCompany(
  prevState: UpdateExternalCompanyState,
  formData: FormData,
): Promise<UpdateExternalCompanyState> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const companyId = formData.get("companyId") as string | null;
  const name = (formData.get("name") as string | null)?.trim();
  const type = formData.get("type") as string | null;
  const country = formData.get("country") as string | null;
  const defaultCurrency = formData.get("defaultCurrency") as string | null;

  if (!orgSlug || !companyId) return { error: "Missing orgSlug or companyId" };
  if (!name || !type || !country || !defaultCurrency) {
    return { error: "All fields are required" };
  }

  if (type !== "DISTRIBUTOR" && type !== "ARCHITECTURAL_FIRM") {
    return { error: "Invalid company type" };
  }

  if (country !== "INDIA" && country !== "UAE") {
    return { error: "Invalid country" };
  }

  if (
    defaultCurrency !== "INR" &&
    defaultCurrency !== "AED" &&
    defaultCurrency !== "USD"
  ) {
    return { error: "Invalid default currency" };
  }

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/external-companies/${companyId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name, type, country, defaultCurrency }),
    },
  );

  if (res.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (res.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    return { error: body.error ?? "Failed to update company" };
  }

  revalidatePath(`/${orgSlug}/admin/external-companies`);
  redirect(await orgHref(orgSlug, "/admin/external-companies"), RedirectType.replace);
}

// ---------------------------------------------------------------------------
// deleteExternalCompany
// ---------------------------------------------------------------------------

/**
 * Delete an external company from the org.
 *
 * Gate: MANAGE_USERS (enforced by DELETE /api/v1/orgs/[orgSlug]/external-companies/[companyId]).
 * FK cascade: User/Project/Inquiry.externalCompanyId use ON DELETE SET NULL — no blocker.
 *
 * Throws on error so the caller (DeleteCompanyButton) can surface it.
 *
 * Stage 13 Batch 2.
 */
export async function deleteExternalCompany(formData: FormData): Promise<void> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const companyId = formData.get("companyId") as string | null;

  if (!companyId) throw new Error("companyId is required");

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/external-companies/${companyId}`,
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

  revalidatePath(`/${orgSlug}/admin/external-companies`);
}
