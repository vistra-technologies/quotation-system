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
 * Uses the useActionState signature so the client form can surface errors
 * (e.g. inquiry number conflict on concurrent creates) rather than crashing
 * to an error boundary.
 */
export async function createInquiry(
  prevState: CreateInquiryState,
  formData: FormData,
): Promise<CreateInquiryState> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";

  const name = (formData.get("name") as string | null)?.trim();
  const destinationCountry = (
    formData.get("destinationCountry") as string | null
  )?.trim();
  const currency = (formData.get("currency") as string | null)
    ?.trim()
    .toUpperCase();
  const externalCompanyId =
    (formData.get("externalCompanyId") as string | null) || null;

  if (!name || !destinationCountry || !currency) {
    return { error: "Name, destination country, and currency are required." };
  }

  const res = await internalFetch(`/api/v1/orgs/${orgSlug}/inquiries`, {
    method: "POST",
    body: JSON.stringify({
      name,
      destinationCountry,
      currency,
      externalCompanyId,
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
