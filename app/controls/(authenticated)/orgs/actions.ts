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
 * On success, redirects to the new org's workspace Overview tab (the mismatch chip in the header
 * flags a structural mismatch between the formula set and the org's component types).
 */
export async function createOrg(
  prevState: CreateOrgState,
  formData: FormData,
): Promise<CreateOrgState> {
  const name = (formData.get("name") as string | null)?.trim();
  const slug = (formData.get("slug") as string | null)?.trim().toLowerCase();
  const adminPassword = (formData.get("adminPassword") as string | null) ?? "";
  const formulaSetId = (formData.get("formulaSetId") as string | null)?.trim();
  const userLimitRaw = (formData.get("userLimit") as string | null)?.trim() ?? "";

  if (!name) return { error: "Organization name is required" };
  if (!slug) return { error: "Slug is required" };
  if (!adminPassword) return { error: "Admin password is required" };
  if (adminPassword.length < 8) return { error: "Admin password must be at least 8 characters" };
  if (!formulaSetId) return { error: "A formula set must be selected" };
  // Blank = the default (3). Range is enforced by the API (400); this only avoids sending a non-number.
  const userLimit = userLimitRaw === "" ? undefined : Number(userLimitRaw);
  if (userLimit !== undefined && !Number.isInteger(userLimit)) {
    return { error: "User limit must be a whole number between 1 and 10000" };
  }

  const res = await internalFetch("/api/v1/superadmin/orgs", {
    method: "POST",
    body: JSON.stringify({ name, slug, adminPassword, formulaSetId, ...(userLimit !== undefined ? { userLimit } : {}) }),
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
  revalidatePath("/controls", "layout");
  // Redirect to the new org's workspace — a formula mismatch (if any) shows as a chip in its header
  // and in detail on the Formula & Pricing tab.
  redirect(`/controls/orgs/${data.org.id}/overview`, RedirectType.replace);
}

// ─── editOrg ─────────────────────────────────────────────────────────────────

export type EditOrgState = {
  error: string | null;
  saved: boolean;
  warnings: OrgFormulaWarning[];
};

/**
 * Update an existing org's name, formula set assignment and/or user limit.
 *
 * Thin marshaler: parses FormData, delegates to PATCH /api/v1/superadmin/orgs/[orgId].
 * Each workspace tab posts only its own fields (Overview: name + userLimit; Formula & Pricing: formulaSetId),
 * so either may be absent but at least one is required (the route enforces the same).
 * On success, returns { saved: true, warnings } — the page stays on the same URL
 * and re-renders the mismatch panel with any warnings from the response.
 *
 * Stage 25 Batch 5; split per tab in Stage 29 Batch 1.
 */
export async function editOrg(
  prevState: EditOrgState,
  formData: FormData,
): Promise<EditOrgState> {
  const orgId = (formData.get("orgId") as string | null)?.trim();
  const name = (formData.get("name") as string | null)?.trim();
  const formulaSetId = (formData.get("formulaSetId") as string | null)?.trim();
  const userLimitRaw = (formData.get("userLimit") as string | null)?.trim();

  if (!orgId) return { error: "Org ID is missing — please reload the page.", saved: false, warnings: [] };
  // A field that is posted but blank is an error; a field that isn't posted is simply not updated.
  if (formData.has("name") && !name) return { error: "Organization name is required.", saved: false, warnings: [] };
  if (formData.has("formulaSetId") && !formulaSetId) return { error: "A formula set must be selected.", saved: false, warnings: [] };
  if (formData.has("userLimit") && !userLimitRaw) return { error: "User limit is required.", saved: false, warnings: [] };
  const userLimit = userLimitRaw ? Number(userLimitRaw) : undefined;
  if (userLimit !== undefined && !Number.isInteger(userLimit)) {
    return { error: "User limit must be a whole number between 1 and 10000.", saved: false, warnings: [] };
  }
  if (!name && !formulaSetId && userLimit === undefined) return { error: "Nothing to save.", saved: false, warnings: [] };

  const res = await internalFetch(`/api/v1/superadmin/orgs/${orgId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(name ? { name } : {}),
      ...(formulaSetId ? { formulaSetId } : {}),
      ...(userLimit !== undefined ? { userLimit } : {}),
    }),
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
  // Layout scope: the workspace header and the shell's org dropdown both show this org.
  revalidatePath("/controls", "layout");
  return { error: null, saved: true, warnings: data.warnings ?? [] };
}
