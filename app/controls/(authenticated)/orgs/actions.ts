"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import type { OrgFormulaWarning } from "@/lib/data/superadmin/orgs";

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
 *
 * Batch 5: now also reads formulaSetId from FormData and forwards it to the API.
 * On success, redirects to the new org's edit page (where mismatch warnings are shown
 * if the formula set has a structural mismatch with the org's component types).
 */
export async function createOrg(
  prevState: CreateOrgState,
  formData: FormData,
): Promise<CreateOrgState> {
  const name = (formData.get("name") as string | null)?.trim();
  const slug = (formData.get("slug") as string | null)?.trim().toLowerCase();
  const adminPassword = (formData.get("adminPassword") as string | null) ?? "";
  const formulaSetId = (formData.get("formulaSetId") as string | null)?.trim();

  if (!name) return { error: "Organization name is required" };
  if (!slug) return { error: "Slug is required" };
  if (!adminPassword) return { error: "Admin password is required" };
  if (adminPassword.length < 8) return { error: "Admin password must be at least 8 characters" };
  if (!formulaSetId) return { error: "A formula set must be selected" };

  const res = await internalFetch("/api/v1/superadmin/orgs", {
    method: "POST",
    body: JSON.stringify({ name, slug, adminPassword, formulaSetId }),
  });

  if (res.status === 401) {
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

  const data = (await res.json()) as { org: { id: string } };
  revalidatePath("/controls/orgs");
  // Redirect to the new org's edit page — mismatch warnings (if any) are shown there.
  redirect(`/controls/orgs/${data.org.id}`, RedirectType.replace);
}

// ─── editOrg ─────────────────────────────────────────────────────────────────

export type EditOrgState = {
  error: string | null;
  saved: boolean;
  warnings: OrgFormulaWarning[];
};

/**
 * Update an existing org's name and/or formula set assignment.
 *
 * Thin marshaler: parses FormData, delegates to PATCH /api/v1/superadmin/orgs/[orgId].
 * On success, returns { saved: true, warnings } — the edit page stays on the same URL
 * and re-renders the mismatch panel with any warnings from the response.
 *
 * Stage 25 Batch 5.
 */
export async function editOrg(
  prevState: EditOrgState,
  formData: FormData,
): Promise<EditOrgState> {
  const orgId = (formData.get("orgId") as string | null)?.trim();
  const name = (formData.get("name") as string | null)?.trim();
  const formulaSetId = (formData.get("formulaSetId") as string | null)?.trim();

  if (!orgId) return { error: "Org ID is missing — please reload the page.", saved: false, warnings: [] };
  if (!name) return { error: "Organization name is required.", saved: false, warnings: [] };
  if (!formulaSetId) return { error: "A formula set must be selected.", saved: false, warnings: [] };

  const res = await internalFetch(`/api/v1/superadmin/orgs/${orgId}`, {
    method: "PATCH",
    body: JSON.stringify({ name, formulaSetId }),
  });

  if (res.status === 401) {
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
    return { error: errorMessage, saved: false, warnings: [] };
  }

  const data = (await res.json()) as { warnings: OrgFormulaWarning[] };
  revalidatePath(`/controls/orgs/${orgId}`);
  revalidatePath("/controls/orgs");
  return { error: null, saved: true, warnings: data.warnings ?? [] };
}
