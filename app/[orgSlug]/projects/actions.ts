"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { createProject as dalCreateProject } from "@/lib/data/projects";
import { requireSession } from "@/lib/data/session";

// ---------------------------------------------------------------------------
// createProject
// ---------------------------------------------------------------------------

export type CreateProjectState = { error: string | null };

/**
 * Create a new project within the session's org.
 *
 * Uses the useActionState signature so the client form can surface errors
 * (e.g. project number conflict on concurrent creates) rather than crashing
 * to an error boundary. All DB work and tenancy is delegated to lib/data/projects.ts.
 */
export async function createProject(
  prevState: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const session = await requireSession(orgSlug ?? "");

  const name = (formData.get("name") as string | null)?.trim();
  const destinationCountry = (formData.get("destinationCountry") as string | null)?.trim();
  const currency = (formData.get("currency") as string | null)?.trim().toUpperCase();
  const externalCompanyId = (formData.get("externalCompanyId") as string | null) || null;
  const status = (formData.get("status") as string | null)?.trim() || "DRAFT";

  if (!name || !destinationCountry || !currency) {
    return { error: "Name, destination country, and currency are required." };
  }

  try {
    await dalCreateProject(session, {
      name,
      destinationCountry,
      currency,
      status,
      externalCompanyId,
    });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "SEQUENCE_CONFLICT"
    ) {
      return { error: "A project number conflict occurred — please try again." };
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

  revalidatePath(`/${orgSlug}/projects`);
  redirect(`/${orgSlug}/projects`, RedirectType.replace);
}
