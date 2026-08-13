"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// ---------------------------------------------------------------------------
// createInquiry
// ---------------------------------------------------------------------------

export type CreateInquiryState = { error: string | null };

/**
 * Create a new inquiry within the session's org.
 *
 * Thin marshaler (Stage 12): parses FormData, delegates to
 * POST /api/v1/orgs/[orgSlug]/inquiries via internalFetch.
 * All tenancy enforcement and business logic live in the route handler.
 *
 * Stage 14 Batch B: destinationCountry removed (derived server-side, D19);
 * 15 new extended intake fields added; projectLocation now required (D22).
 */
export async function createInquiry(
  prevState: CreateInquiryState,
  formData: FormData,
): Promise<CreateInquiryState> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";

  const name = (formData.get("name") as string | null)?.trim();
  const currency = (formData.get("currency") as string | null)?.trim().toUpperCase();
  const projectLocation =
    ((formData.get("projectLocation") as string | null)?.trim()) || null;
  const externalCompanyId =
    (formData.get("externalCompanyId") as string | null) || null;

  // Stage 14 — extended intake fields
  const submissionDate =
    ((formData.get("submissionDate") as string | null)?.trim()) || null;
  const projectDeadline =
    ((formData.get("projectDeadline") as string | null)?.trim()) || null;
  const projectBudget =
    ((formData.get("projectBudget") as string | null)?.trim()) || null;
  const mainContractorName =
    ((formData.get("mainContractorName") as string | null)?.trim()) || null;
  const interiorContractorName =
    ((formData.get("interiorContractorName") as string | null)?.trim()) || null;
  const mainConsultantName =
    ((formData.get("mainConsultantName") as string | null)?.trim()) || null;
  const interiorConsultantName =
    ((formData.get("interiorConsultantName") as string | null)?.trim()) || null;
  const endClientName =
    ((formData.get("endClientName") as string | null)?.trim()) || null;
  const endClientPhone =
    ((formData.get("endClientPhone") as string | null)?.trim()) || null;
  const endClientEmail =
    ((formData.get("endClientEmail") as string | null)?.trim()) || null;
  const endClientAddressLine1 =
    ((formData.get("endClientAddressLine1") as string | null)?.trim()) || null;
  const endClientAddressLine2 =
    ((formData.get("endClientAddressLine2") as string | null)?.trim()) || null;
  const endClientCity =
    ((formData.get("endClientCity") as string | null)?.trim()) || null;
  const endClientState =
    ((formData.get("endClientState") as string | null)?.trim()) || null;
  const endClientGstNumber =
    ((formData.get("endClientGstNumber") as string | null)?.trim()) || null;

  if (!name || !currency) {
    return { error: "Name and currency are required." };
  }

  const res = await internalFetch(`/api/v1/orgs/${orgSlug}/inquiries`, {
    method: "POST",
    body: JSON.stringify({
      name,
      currency,
      projectLocation,
      externalCompanyId,
      // Stage 14 — extended intake fields (dates sent as ISO date strings)
      submissionDate,
      projectDeadline,
      projectBudget,
      mainContractorName,
      interiorContractorName,
      mainConsultantName,
      interiorConsultantName,
      endClientName,
      endClientPhone,
      endClientEmail,
      endClientAddressLine1,
      endClientAddressLine2,
      endClientCity,
      endClientState,
      endClientGstNumber,
    }),
  });

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
    return { error: errorMessage };
  }

  revalidatePath(`/${orgSlug}/inquiries`);
  redirect(await orgHref(orgSlug, "/inquiries"), RedirectType.replace);
}

// ---------------------------------------------------------------------------
// updateInquiry
// ---------------------------------------------------------------------------

export type UpdateInquiryState = { error: string | null };

/**
 * Update editable fields on an existing inquiry.
 *
 * Thin marshaler: parses FormData, delegates to
 * PATCH /api/v1/orgs/[orgSlug]/inquiries/[inquiryId] via internalFetch.
 * All tenancy enforcement and business logic live in the route handler.
 *
 * Stage 14 Batch B: destinationCountry removed (locked at create time, D19);
 * 15 new extended intake fields added.
 */
export async function updateInquiry(
  prevState: UpdateInquiryState,
  formData: FormData,
): Promise<UpdateInquiryState> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const inquiryId = formData.get("inquiryId") as string | null;

  if (!inquiryId) return { error: "Missing inquiry ID." };

  const name = (formData.get("name") as string | null)?.trim();
  const currency = (formData.get("currency") as string | null)?.trim().toUpperCase();
  const projectLocation =
    ((formData.get("projectLocation") as string | null)?.trim()) || null;

  // Stage 14 — extended intake fields
  const submissionDate =
    ((formData.get("submissionDate") as string | null)?.trim()) || null;
  const projectDeadline =
    ((formData.get("projectDeadline") as string | null)?.trim()) || null;
  const projectBudget =
    ((formData.get("projectBudget") as string | null)?.trim()) || null;
  const mainContractorName =
    ((formData.get("mainContractorName") as string | null)?.trim()) || null;
  const interiorContractorName =
    ((formData.get("interiorContractorName") as string | null)?.trim()) || null;
  const mainConsultantName =
    ((formData.get("mainConsultantName") as string | null)?.trim()) || null;
  const interiorConsultantName =
    ((formData.get("interiorConsultantName") as string | null)?.trim()) || null;
  const endClientName =
    ((formData.get("endClientName") as string | null)?.trim()) || null;
  const endClientPhone =
    ((formData.get("endClientPhone") as string | null)?.trim()) || null;
  const endClientEmail =
    ((formData.get("endClientEmail") as string | null)?.trim()) || null;
  const endClientAddressLine1 =
    ((formData.get("endClientAddressLine1") as string | null)?.trim()) || null;
  const endClientAddressLine2 =
    ((formData.get("endClientAddressLine2") as string | null)?.trim()) || null;
  const endClientCity =
    ((formData.get("endClientCity") as string | null)?.trim()) || null;
  const endClientState =
    ((formData.get("endClientState") as string | null)?.trim()) || null;
  const endClientGstNumber =
    ((formData.get("endClientGstNumber") as string | null)?.trim()) || null;

  if (!name || !currency) {
    return { error: "Name and currency are required." };
  }

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/inquiries/${inquiryId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name,
        currency,
        projectLocation,
        // Stage 14 — extended intake fields
        submissionDate,
        projectDeadline,
        projectBudget,
        mainContractorName,
        interiorContractorName,
        mainConsultantName,
        interiorConsultantName,
        endClientName,
        endClientPhone,
        endClientEmail,
        endClientAddressLine1,
        endClientAddressLine2,
        endClientCity,
        endClientState,
        endClientGstNumber,
      }),
    },
  );

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (res.status === 409) {
    return { error: "This inquiry can no longer be edited (already dismissed or converted)." };
  }

  if (!res.ok) {
    let errorMessage = "An unexpected error occurred — please try again.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // ignore JSON parse failure
    }
    return { error: errorMessage };
  }

  revalidatePath(`/${orgSlug}/inquiries`);
  revalidatePath(`/${orgSlug}/inquiries/${inquiryId}`);
  redirect(
    await orgHref(orgSlug, `/inquiries/${inquiryId}`),
    RedirectType.replace,
  );
}

// ---------------------------------------------------------------------------
// dismissInquiry
// ---------------------------------------------------------------------------

/**
 * Dismiss an inquiry (status → DISMISSED).
 *
 * Thin marshaler (Stage 12): delegates to
 * PATCH /api/v1/orgs/[orgSlug]/inquiries/[inquiryId] via internalFetch.
 * All tenancy enforcement and business logic live in the route handler.
 *
 * Plain RSC server action — used directly as `<form action={dismissInquiry}>`.
 * No useActionState needed: dismiss is a low-risk status flip, the button is
 * disabled when the inquiry is already closed, and a 409 ALREADY_CLOSED from
 * the API is treated as success (idempotency) — the button being disabled is
 * the real guard.
 */
export async function dismissInquiry(formData: FormData): Promise<void> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const inquiryId = formData.get("inquiryId") as string | null;

  if (!inquiryId) return;

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/inquiries/${inquiryId}`,
    { method: "PATCH" },
  );

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  // 409 = ALREADY_CLOSED — idempotent, treat as success and navigate back.
  // The UI button is disabled for closed inquiries so this is a belt check.

  revalidatePath(`/${orgSlug}/inquiries`);
  revalidatePath(`/${orgSlug}/inquiries/${inquiryId}`);
  redirect(
    await orgHref(orgSlug, `/inquiries/${inquiryId}`),
    RedirectType.replace,
  );
}

// ---------------------------------------------------------------------------
// convertInquiryToProject
// ---------------------------------------------------------------------------

export type ConvertInquiryState = { error: string | null };

/**
 * Convert an inquiry into a Project ("Start Project" action).
 *
 * Thin marshaler (Stage 12): delegates to
 * POST /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]/convert via internalFetch.
 * All tenancy enforcement and business logic live in the route handler.
 *
 * On success, redirects to the newly created project's detail page.
 * Surfaces SEQUENCE_CONFLICT (concurrent projectNumber race) and ALREADY_CLOSED
 * (inquiry already dismissed or converted) as inline form errors.
 */
export async function convertInquiryToProject(
  prevState: ConvertInquiryState,
  formData: FormData,
): Promise<ConvertInquiryState> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const inquiryId = formData.get("inquiryId") as string | null;

  if (!inquiryId) {
    return { error: "Missing inquiry ID." };
  }

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/inquiries/${inquiryId}/convert`,
    { method: "POST" },
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
    return { error: errorMessage };
  }

  const body = (await res.json()) as { project: { id: string } };
  const projectId = body.project.id;

  revalidatePath(`/${orgSlug}/inquiries`);
  revalidatePath(`/${orgSlug}/inquiries/${inquiryId}`);
  revalidatePath(`/${orgSlug}/projects`);
  redirect(await orgHref(orgSlug, `/projects/${projectId}`));
}
