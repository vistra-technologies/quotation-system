"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

/**
 * Create a new Role scoped to the session's organization.
 * Gate: MANAGE_FEATURES.
 * On success, revalidates the roles list and redirects to the new role's detail page.
 */
export async function createRole(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const session = await getSession();
  if (!session) redirect(orgSlug ? `/${orgSlug}/login` : "/");

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

  const role = await prisma.role.create({
    data: {
      organizationId: session.organizationId,
      name,
      description,
    },
  });

  revalidatePath(`/${orgSlug}/admin/roles`);
  redirect(`/${orgSlug}/admin/roles/${role.id}`);
}

/**
 * Grant a permission to a role (upsert — idempotent if already granted).
 * Gate: MANAGE_FEATURES.
 * Tenancy guard: verifies the target role belongs to the session's org before writing.
 */
export async function addRolePermission(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const roleId = formData.get("roleId") as string | null;
  const permissionId = formData.get("permissionId") as string | null;

  const session = await getSession();
  if (!session) redirect(orgSlug ? `/${orgSlug}/login` : "/");

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      throw new Error("Forbidden: missing MANAGE_FEATURES permission");
    }
    throw e;
  }

  if (!roleId || !permissionId) throw new Error("roleId and permissionId are required");

  // Tenancy guard: the role must belong to this session's org.
  // A client-supplied roleId that belongs to another org would be a real security breach —
  // granting permissions to another org's role through our session.
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!role) throw new Error("Role not found or access denied");

  // composite PK (roleId, permissionId) is the upsert key — see profile §5
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId, permissionId } },
    create: { roleId, permissionId },
    update: {},
  });

  revalidatePath(`/${orgSlug}/admin/roles/${roleId}`);
}

/**
 * Revoke a permission from a role.
 * Gate: MANAGE_FEATURES.
 * Tenancy guard: verifies the target role belongs to the session's org before deleting.
 */
export async function removeRolePermission(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const roleId = formData.get("roleId") as string | null;
  const permissionId = formData.get("permissionId") as string | null;

  const session = await getSession();
  if (!session) redirect(orgSlug ? `/${orgSlug}/login` : "/");

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      throw new Error("Forbidden: missing MANAGE_FEATURES permission");
    }
    throw e;
  }

  if (!roleId || !permissionId) throw new Error("roleId and permissionId are required");

  // Tenancy guard: the role must belong to this session's org.
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!role) throw new Error("Role not found or access denied");

  await prisma.rolePermission.delete({
    where: { roleId_permissionId: { roleId, permissionId } },
  });

  revalidatePath(`/${orgSlug}/admin/roles/${roleId}`);
}
