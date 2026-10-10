"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { isSupportedCurrency } from "@/lib/currency";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { withAction } from "@/lib/with-route";

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
export const createExternalCompany = withAction(
  "app/[orgSlug]/admin/external-companies/actions#createExternalCompany",
  async (
  prevState: CreateExternalCompanyState,
  formData: FormData,
): Promise<CreateExternalCompanyState> => {
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

  if (!isSupportedCurrency(defaultCurrency)) {
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
});

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
export const updateExternalCompany = withAction(
  "app/[orgSlug]/admin/external-companies/actions#updateExternalCompany",
  async (
  prevState: UpdateExternalCompanyState,
  formData: FormData,
): Promise<UpdateExternalCompanyState> => {
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

  if (!isSupportedCurrency(defaultCurrency)) {
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
});

// ---------------------------------------------------------------------------
// deleteExternalCompany
// ---------------------------------------------------------------------------

/**
 * Delete an external company from the org.
 *
 * Gate: MANAGE_USERS (enforced by DELETE /api/v1/orgs/[orgSlug]/external-companies/[companyId]).
 * Stage 31 S31-5: the route refuses (409 COMPANY_HAS_RECORDS) while the company still has users,
 * projects or inquiries. Returns state, never throws, so the message ("This company still has 2
 * user(s)... Reassign or remove them first.") reaches DeleteCompanyButton instead of a generic 500
 * (a thrown server-action error loses its message in production).
 *
 * Stage 13 Batch 2.
 */
export type DeleteCompanyState = { error: string | null; success: boolean };

export const deleteExternalCompany = withAction(
  "app/[orgSlug]/admin/external-companies/actions#deleteExternalCompany",
  async (formData: FormData): Promise<DeleteCompanyState> => {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const companyId = formData.get("companyId") as string | null;

  if (!companyId) return { error: "companyId is required", success: false };

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/external-companies/${companyId}`,
    { method: "DELETE" },
  );

  if (res.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (res.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  if (!res.ok) {
    let errorMessage = "An unexpected error occurred — please try again.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // ignore JSON parse failure
    }
    return { error: errorMessage, success: false };
  }

  revalidatePath(`/${orgSlug}/admin/external-companies`);
  return { error: null, success: true };
});
