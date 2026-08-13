"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// ---------------------------------------------------------------------------
// createProject
// ---------------------------------------------------------------------------

export type CreateProjectState = { error: string | null };

/**
 * Create a new project within the session's org.
 *
 * Thin marshaler (Stage 12): parses FormData, delegates to
 * POST /api/v1/orgs/[orgSlug]/projects via internalFetch.
 * All tenancy enforcement and business logic live in the route handler.
 *
 * Uses the useActionState signature so the client form can surface errors
 * (e.g. project number conflict on concurrent creates) rather than crashing
 * to an error boundary.
 *
 * Stage 14 Batch C: removed destinationCountry (derived server-side, D19);
 * added 15 extended intake fields.
 */
export async function createProject(
  prevState: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";

  const name = (formData.get("name") as string | null)?.trim();
  const currency = (formData.get("currency") as string | null)?.trim().toUpperCase();
  const projectLocation =
    ((formData.get("projectLocation") as string | null)?.trim()) || null;
  const externalCompanyId = (formData.get("externalCompanyId") as string | null) || null;
  const status = (formData.get("status") as string | null)?.trim() || "DRAFT";

  if (!name || !currency) {
    return { error: "Project name and currency are required." };
  }

  // Stage 14 Batch C — extended intake fields
  const getStr = (key: string): string | null =>
    (formData.get(key) as string | null)?.trim() || null;

  const res = await internalFetch(`/api/v1/orgs/${orgSlug}/projects`, {
    method: "POST",
    body: JSON.stringify({
      name,
      currency,
      projectLocation,
      status,
      externalCompanyId,
      submissionDate: getStr("submissionDate"),
      projectDeadline: getStr("projectDeadline"),
      projectBudget: getStr("projectBudget"),
      mainContractorName: getStr("mainContractorName"),
      interiorContractorName: getStr("interiorContractorName"),
      mainConsultantName: getStr("mainConsultantName"),
      interiorConsultantName: getStr("interiorConsultantName"),
      endClientName: getStr("endClientName"),
      endClientPhone: getStr("endClientPhone"),
      endClientEmail: getStr("endClientEmail"),
      endClientAddressLine1: getStr("endClientAddressLine1"),
      endClientAddressLine2: getStr("endClientAddressLine2"),
      endClientCity: getStr("endClientCity"),
      endClientState: getStr("endClientState"),
      endClientGstNumber: getStr("endClientGstNumber"),
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

  const body = (await res.json()) as { project: { id: string } };
  const projectId = body.project.id;

  revalidatePath(`/${orgSlug}/projects`);
  redirect(await orgHref(orgSlug, `/projects/${projectId}`), RedirectType.replace);
}

// ---------------------------------------------------------------------------
// updateProject
// ---------------------------------------------------------------------------

export type UpdateProjectState = { error: string | null };

/**
 * Update editable fields on an existing DRAFT project.
 *
 * Thin marshaler: parses FormData, delegates to
 * PATCH /api/v1/orgs/[orgSlug]/projects/[projectId] via internalFetch.
 * All tenancy enforcement and business logic live in the route handler.
 *
 * Stage 14 Batch C: removed destinationCountry (derived at create, never updated, D19);
 * added 15 extended intake fields.
 */
export async function updateProject(
  prevState: UpdateProjectState,
  formData: FormData,
): Promise<UpdateProjectState> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const projectId = (formData.get("projectId") as string | null) ?? "";

  const name = (formData.get("name") as string | null)?.trim();
  const currency = (formData.get("currency") as string | null)?.trim().toUpperCase();
  const projectLocationRaw = (formData.get("projectLocation") as string | null)?.trim();
  const projectLocation = projectLocationRaw || null;

  if (!name || !currency) {
    return { error: "Project name and currency are required." };
  }

  // Stage 14 Batch C — extended intake fields
  const getStr = (key: string): string | null =>
    (formData.get(key) as string | null)?.trim() || null;

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/projects/${projectId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name,
        currency,
        projectLocation,
        submissionDate: getStr("submissionDate"),
        projectDeadline: getStr("projectDeadline"),
        projectBudget: getStr("projectBudget"),
        mainContractorName: getStr("mainContractorName"),
        interiorContractorName: getStr("interiorContractorName"),
        mainConsultantName: getStr("mainConsultantName"),
        interiorConsultantName: getStr("interiorConsultantName"),
        endClientName: getStr("endClientName"),
        endClientPhone: getStr("endClientPhone"),
        endClientEmail: getStr("endClientEmail"),
        endClientAddressLine1: getStr("endClientAddressLine1"),
        endClientAddressLine2: getStr("endClientAddressLine2"),
        endClientCity: getStr("endClientCity"),
        endClientState: getStr("endClientState"),
        endClientGstNumber: getStr("endClientGstNumber"),
      }),
    },
  );

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (res.status === 409) {
    return {
      error:
        "This project cannot be edited — only DRAFT projects are editable.",
    };
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

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  redirect(await orgHref(orgSlug, `/projects/${projectId}`), RedirectType.replace);
}
