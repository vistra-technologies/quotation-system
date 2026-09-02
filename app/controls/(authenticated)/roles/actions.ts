"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";

// ─── createSuperAdminRole ─────────────────────────────────────────────────────

export type RoleActionState = { error: string | null };

/**
 * Create a new role for the selected org.
 *
 * Thin marshaler (Stage 12 pattern): parses FormData, delegates to
 * POST /api/v1/superadmin/roles via internalFetch.
 * All validation and audit log writing live in the route handler + DAL.
 *
 * Uses the useActionState signature so the client form can surface errors.
 */
export async function createSuperAdminRole(
  prevState: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  const orgId = (formData.get("orgId") as string | null)?.trim();
  const name = (formData.get("name") as string | null)?.trim();
  const description = (formData.get("description") as string | null)?.trim() || undefined;

  if (!orgId) return { error: "Organization is required" };
  if (!name) return { error: "Role name is required" };

  const res = await internalFetch("/api/v1/superadmin/roles", {
    method: "POST",
    body: JSON.stringify({ orgId, name, description }),
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

  const { role } = (await res.json()) as { role: { id: string } };

  revalidatePath("/controls/roles");
  // Redirect to the role detail view.
  redirect(`/controls/roles?orgId=${encodeURIComponent(orgId)}&roleId=${encodeURIComponent(role.id)}`);
}

// ─── renameSuperAdminRole ─────────────────────────────────────────────────────

/**
 * Rename an existing role.
 *
 * Uses the useActionState signature so the client form can surface errors.
 */
export async function renameSuperAdminRole(
  prevState: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  const orgId = (formData.get("orgId") as string | null)?.trim();
  const roleId = (formData.get("roleId") as string | null)?.trim();
  const name = (formData.get("name") as string | null)?.trim();

  if (!orgId) return { error: "Organization is required" };
  if (!roleId) return { error: "Role is required" };
  if (!name) return { error: "Role name is required" };

  const res = await internalFetch(`/api/v1/superadmin/roles/${encodeURIComponent(roleId)}`, {
    method: "PATCH",
    body: JSON.stringify({ orgId, name }),
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

  revalidatePath("/controls/roles");
  return { error: null };
}

// ─── grantSuperAdminRolePermission ───────────────────────────────────────────

/**
 * Grant a permission to a role.
 *
 * Plain server action (no useActionState) — permission toggle buttons use the
 * same pattern as app/[orgSlug]/admin/roles/actions.ts addRolePermission:
 * throw on error so the error boundary catches it; revalidate on success.
 */
export async function grantSuperAdminRolePermission(formData: FormData): Promise<void> {
  const orgId = (formData.get("orgId") as string | null)?.trim();
  const roleId = (formData.get("roleId") as string | null)?.trim();
  const permissionId = (formData.get("permissionId") as string | null)?.trim();

  if (!orgId || !roleId || !permissionId) {
    throw new Error("orgId, roleId, and permissionId are required");
  }

  const res = await internalFetch(
    `/api/v1/superadmin/roles/${encodeURIComponent(roleId)}/permissions`,
    {
      method: "POST",
      body: JSON.stringify({ orgId, permissionId }),
    },
  );

  if (res.status === 401) {
    redirect("/controls/login");
  }

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? "Failed to grant permission");
  }

  revalidatePath("/controls/roles");
}

// ─── revokeSuperAdminRolePermission ──────────────────────────────────────────

/**
 * Revoke a permission from a role.
 *
 * Same pattern as grantSuperAdminRolePermission.
 */
export async function revokeSuperAdminRolePermission(formData: FormData): Promise<void> {
  const orgId = (formData.get("orgId") as string | null)?.trim();
  const roleId = (formData.get("roleId") as string | null)?.trim();
  const permissionId = (formData.get("permissionId") as string | null)?.trim();

  if (!orgId || !roleId || !permissionId) {
    throw new Error("orgId, roleId, and permissionId are required");
  }

  const res = await internalFetch(
    `/api/v1/superadmin/roles/${encodeURIComponent(roleId)}/permissions`,
    {
      method: "DELETE",
      body: JSON.stringify({ orgId, permissionId }),
    },
  );

  if (res.status === 401) {
    redirect("/controls/login");
  }

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? "Failed to revoke permission");
  }

  revalidatePath("/controls/roles");
}
