"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import {
  createRole as dalCreateRole,
  addRolePermission as dalAddRolePermission,
  removeRolePermission as dalRemoveRolePermission,
} from "@/lib/data/admin";
import { requireSession } from "@/lib/data/session";

/**
 * Create a new Role scoped to the session's organization.
 * Gate: MANAGE_FEATURES.
 * On success, revalidates the roles list and redirects to the new role's detail page.
 */
export async function createRole(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const session = await requireSession(orgSlug ?? "");

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      throw new Error("Forbidden: missing MANAGE_FEATURES permission");
    }
    throw e;
  }

  const name = (formData.get("name") as string | null)?.trim();
  const description = (formData.get("description") as string | null)?.trim() || null;

  if (!name) throw new Error("Role name is required");

  const role = await dalCreateRole(session, { name, description });

  revalidatePath(`/${orgSlug}/admin/roles`);
  redirect(`/${orgSlug}/admin/roles/${role.id}`);
}

/**
 * Grant a permission to a role (upsert — idempotent if already granted).
 * Gate: MANAGE_FEATURES.
 * Tenancy guard: delegated to lib/data/admin.ts assertRoleInOrg.
 */
export async function addRolePermission(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const roleId = formData.get("roleId") as string | null;
  const permissionId = formData.get("permissionId") as string | null;

  const session = await requireSession(orgSlug ?? "");

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      throw new Error("Forbidden: missing MANAGE_FEATURES permission");
    }
    throw e;
  }

  if (!roleId || !permissionId) throw new Error("roleId and permissionId are required");

  await dalAddRolePermission(session, roleId, permissionId);

  revalidatePath(`/${orgSlug}/admin/roles/${roleId}`);
}

/**
 * Revoke a permission from a role.
 * Gate: MANAGE_FEATURES.
 * Tenancy guard: delegated to lib/data/admin.ts assertRoleInOrg.
 */
export async function removeRolePermission(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const roleId = formData.get("roleId") as string | null;
  const permissionId = formData.get("permissionId") as string | null;

  const session = await requireSession(orgSlug ?? "");

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      throw new Error("Forbidden: missing MANAGE_FEATURES permission");
    }
    throw e;
  }

  if (!roleId || !permissionId) throw new Error("roleId and permissionId are required");

  await dalRemoveRolePermission(session, roleId, permissionId);

  revalidatePath(`/${orgSlug}/admin/roles/${roleId}`);
}
