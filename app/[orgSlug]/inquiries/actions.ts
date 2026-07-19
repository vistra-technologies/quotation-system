"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { createInquiry as dalCreateInquiry } from "@/lib/data/inquiries";
import { dismissInquiry as dalDismissInquiry } from "@/lib/data/inquiries";
import { convertInquiryToProject as dalConvertInquiryToProject } from "@/lib/data/inquiries";
import { requireSession } from "@/lib/data/session";

// ---------------------------------------------------------------------------
// createInquiry
// ---------------------------------------------------------------------------

export type CreateInquiryState = { error: string | null };

/**
 * Create a new inquiry within the session's org.
 *
 * Uses the useActionState signature so the client form can surface errors
 * (e.g. inquiry number conflict on concurrent creates) rather than crashing
 * to an error boundary. All DB work and tenancy is delegated to lib/data/inquiries.ts.
 */
export async function createInquiry(
  prevState: CreateInquiryState,
  formData: FormData,
): Promise<CreateInquiryState> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const session = await requireSession(orgSlug ?? "");

  const name = (formData.get("name") as string | null)?.trim();
  const destinationCountry = (formData.get("destinationCountry") as string | null)?.trim();
  const currency = (formData.get("currency") as string | null)?.trim().toUpperCase();
  const externalCompanyId = (formData.get("externalCompanyId") as string | null) || null;

  if (!name || !destinationCountry || !currency) {
    return { error: "Name, destination country, and currency are required." };
  }

  try {
    await dalCreateInquiry(session, {
      name,
      destinationCountry,
      currency,
      externalCompanyId,
    });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "SEQUENCE_CONFLICT"
    ) {
      return { error: "An inquiry number conflict occurred — please try again." };
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "INVALID_EXTERNAL_COMPANY"
    ) {
      return { error: "Selected company is invalid." };
    }
    throw err;
  }

  revalidatePath(`/${orgSlug}/inquiries`);
  redirect(`/${orgSlug}/inquiries`, RedirectType.replace);
}

// ---------------------------------------------------------------------------
// dismissInquiry
// ---------------------------------------------------------------------------

/**
 * Dismiss an inquiry (status → DISMISSED).
 *
 * Plain RSC server action — used directly as `<form action={dismissInquiry}>`.
 * No useActionState needed: dismiss is a low-risk status flip, the button is
 * disabled when the inquiry is already closed, and on error we let Next.js
 * surface it (the ALREADY_CLOSED guard is a belt-and-suspenders check for
 * direct/concurrent requests).
 */
export async function dismissInquiry(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const inquiryId = formData.get("inquiryId") as string | null;
  const session = await requireSession(orgSlug ?? "");

  if (!inquiryId) return;

  try {
    await dalDismissInquiry(session, inquiryId);
  } catch (err) {
    // ALREADY_CLOSED is not actionable from a plain form — swallow silently
    // (the UI button is disabled for closed inquiries so this is a belt check).
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "ALREADY_CLOSED"
    ) {
      revalidatePath(`/${orgSlug}/inquiries/${inquiryId}`);
      redirect(`/${orgSlug}/inquiries/${inquiryId}`, RedirectType.replace);
    }
    throw err;
  }

  revalidatePath(`/${orgSlug}/inquiries`);
  revalidatePath(`/${orgSlug}/inquiries/${inquiryId}`);
  redirect(`/${orgSlug}/inquiries/${inquiryId}`, RedirectType.replace);
}

// ---------------------------------------------------------------------------
// convertInquiryToProject
// ---------------------------------------------------------------------------

export type ConvertInquiryState = { error: string | null };

/**
 * Convert an inquiry into a Project.
 *
 * On success, redirects to the newly created project's detail page.
 * Surfaces SEQUENCE_CONFLICT inline (concurrent projectNumber race) and
 * ALREADY_CLOSED (inquiry already dismissed or converted).
 */
export async function convertInquiryToProject(
  prevState: ConvertInquiryState,
  formData: FormData,
): Promise<ConvertInquiryState> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const inquiryId = formData.get("inquiryId") as string | null;
  const session = await requireSession(orgSlug ?? "");

  if (!inquiryId) {
    return { error: "Missing inquiry ID." };
  }

  let newProject;
  try {
    newProject = await dalConvertInquiryToProject(session, inquiryId);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err
    ) {
      const code = (err as { code: string }).code;
      if (code === "SEQUENCE_CONFLICT") {
        return { error: "A project number conflict occurred — please try again." };
      }
      if (code === "ALREADY_CLOSED") {
        return { error: "This inquiry is already closed." };
      }
    }
    throw err;
  }

  revalidatePath(`/${orgSlug}/inquiries`);
  revalidatePath(`/${orgSlug}/inquiries/${inquiryId}`);
  revalidatePath(`/${orgSlug}/projects`);
  redirect(`/${orgSlug}/projects/${newProject.id}`);
}
