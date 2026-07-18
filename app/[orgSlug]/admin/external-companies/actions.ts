"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { createExternalCompany as dalCreateExternalCompany } from "@/lib/data/external-companies";
import { requireSession } from "@/lib/data/session";

// ---------------------------------------------------------------------------
// createExternalCompany
// ---------------------------------------------------------------------------

export type CreateExternalCompanyState = { error: string | null };

/**
 * Create a new external company within the session's org.
 *
 * Uses the useActionState signature so the client form can surface errors
 * without crashing to an error boundary.
 * All DB work and tenancy checks are delegated to lib/data/external-companies.ts.
 */
export async function createExternalCompany(
  prevState: CreateExternalCompanyState,
  formData: FormData,
): Promise<CreateExternalCompanyState> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const session = await requireSession(orgSlug ?? "");

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      redirect(`/${orgSlug}/dashboard`);
    }
    throw e;
  }

  const name = (formData.get("name") as string | null)?.trim();
  const type = formData.get("type") as string | null;

  if (!name || !type) {
    return { error: "Name and type are required" };
  }

  if (type !== "DISTRIBUTOR" && type !== "ARCHITECTURAL_FIRM") {
    return { error: "Invalid company type" };
  }

  try {
    await dalCreateExternalCompany(session, { name, type });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "An error occurred" };
  }

  revalidatePath(`/${orgSlug}/admin/external-companies`);
  redirect(`/${orgSlug}/admin/external-companies`);
}
