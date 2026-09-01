"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";

// ─── createOrg ───────────────────────────────────────────────────────────────

export type CreateOrgState = { error: string | null };

/**
 * Create a new organization on the platform.
 *
 * Thin marshaler (Stage 12 pattern): parses FormData, delegates to
 * POST /api/v1/superadmin/orgs via internalFetch.
 * All validation (slug format, RESERVED_ORG_SLUGS check), default-role seeding,
 * and audit log writing live in the route handler + DAL.
 *
 * Uses the useActionState signature so the client form can surface errors
 * (e.g. reserved slug, duplicate slug) rather than crashing to an error boundary.
 */
export async function createOrg(
  prevState: CreateOrgState,
  formData: FormData,
): Promise<CreateOrgState> {
  const name = (formData.get("name") as string | null)?.trim();
  const slug = (formData.get("slug") as string | null)?.trim().toLowerCase();

  if (!name) return { error: "Organization name is required" };
  if (!slug) return { error: "Slug is required" };

  const res = await internalFetch("/api/v1/superadmin/orgs", {
    method: "POST",
    body: JSON.stringify({ name, slug }),
  });

  if (res.status === 401) {
    // Session expired mid-form — redirect to login.
    redirect("/controls/login");
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

  revalidatePath("/controls/orgs");
  redirect("/controls/orgs", RedirectType.replace);
}
