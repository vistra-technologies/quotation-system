"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

/**
 * Create a new Role scoped to the session's organization.
 * Gate: MANAGE_FEATURES (enforced by POST /api/v1/orgs/[orgSlug]/roles).
 * On success, revalidates the roles list and redirects to the new role's detail page.
 *
 * Stage 12 Batch 6: thin marshaler — FormData → internalFetch → redirect.
 */
export async function createRole(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const name = (formData.get("name") as string | null)?.trim();
  const description = (formData.get("description") as string | null)?.trim() || null;

  if (!orgSlug || !name) throw new Error("orgSlug and name are required");

  const res = await internalFetch(`/api/v1/orgs/${orgSlug}/roles`, {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });

  if (res.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (res.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? "Failed to create role");
  }

  const { role } = (await res.json()) as { role: { id: string } };

  revalidatePath(`/${orgSlug}/admin/roles`);
  redirect(`/${orgSlug}/admin/roles/${role.id}`);
}

/**
 * Grant a permission to a role (upsert — idempotent if already granted).
 * Gate: MANAGE_FEATURES (enforced by POST /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions).
 * Tenancy guard: assertRoleInOrg in the route handler.
 *
 * Stage 12 Batch 6: thin marshaler.
 */
export async function addRolePermission(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const roleId = formData.get("roleId") as string | null;
  const permissionId = formData.get("permissionId") as string | null;

  if (!orgSlug || !roleId || !permissionId) {
    throw new Error("orgSlug, roleId, and permissionId are required");
  }

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/roles/${roleId}/permissions`,
    {
      method: "POST",
      body: JSON.stringify({ permissionId }),
    },
  );

  if (res.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (res.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? "Failed to add permission");
  }

  revalidatePath(`/${orgSlug}/admin/roles/${roleId}`);
}

/**
 * Revoke a permission from a role.
 * Gate: MANAGE_FEATURES (enforced by DELETE /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions).
 * Tenancy guard: assertRoleInOrg in the route handler.
 *
 * Stage 12 Batch 6: thin marshaler.
 */
export async function removeRolePermission(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const roleId = formData.get("roleId") as string | null;
  const permissionId = formData.get("permissionId") as string | null;

  if (!orgSlug || !roleId || !permissionId) {
    throw new Error("orgSlug, roleId, and permissionId are required");
  }

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/roles/${roleId}/permissions`,
    {
      method: "DELETE",
      body: JSON.stringify({ permissionId }),
    },
  );

  if (res.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (res.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? "Failed to remove permission");
  }

  revalidatePath(`/${orgSlug}/admin/roles/${roleId}`);
}
