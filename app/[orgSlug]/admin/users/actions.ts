"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import {
  createUser as dalCreateUser,
  activateUser as dalActivateUser,
  deactivateUser as dalDeactivateUser,
  changeUserRole as dalChangeUserRole,
  setUserPassword as dalSetUserPassword,
} from "@/lib/data/users";
import { requireSession } from "@/lib/data/session";

// ---------------------------------------------------------------------------
// createUser
// ---------------------------------------------------------------------------

export type CreateUserState = { error: string | null };

/**
 * Create a new user within the session's org and wire up a better-auth
 * credential account.
 *
 * Uses the useActionState signature so the client form can surface errors
 * (e.g. duplicate username) instead of crashing to an error boundary.
 * All DB work and tenancy checks are delegated to lib/data/users.ts.
 */
export async function createUser(
  prevState: CreateUserState,
  formData: FormData
): Promise<CreateUserState> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const session = await requireSession(orgSlug ?? "");

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      throw new Error("Forbidden: missing MANAGE_USERS permission");
    }
    throw e;
  }

  const username = (formData.get("username") as string | null)?.trim();
  const roleId = formData.get("roleId") as string | null;
  const externalCompanyId = (formData.get("externalCompanyId") as string | null) || null;
  const password = formData.get("password") as string | null;

  if (!username || !roleId || !password) {
    return { error: "Username, role, and password are required" };
  }

  try {
    await dalCreateUser(session, { username, roleId, externalCompanyId, password });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "An error occurred" };
  }

  revalidatePath(`/${orgSlug}/admin/users`);
  redirect(`/${orgSlug}/admin/users`);
}

// ---------------------------------------------------------------------------
// activateUser / deactivateUser
// ---------------------------------------------------------------------------

export async function activateUser(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const userId = formData.get("userId") as string | null;
  const session = await requireSession(orgSlug ?? "");

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (e) {
    if (e instanceof ForbiddenError) throw new Error("Forbidden: missing MANAGE_USERS permission");
    throw e;
  }

  if (!userId) throw new Error("userId is required");
  await dalActivateUser(session, userId);

  revalidatePath(`/${orgSlug}/admin/users`);
  revalidatePath(`/${orgSlug}/admin/users/${userId}`);
}

export async function deactivateUser(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const userId = formData.get("userId") as string | null;
  const session = await requireSession(orgSlug ?? "");

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (e) {
    if (e instanceof ForbiddenError) throw new Error("Forbidden: missing MANAGE_USERS permission");
    throw e;
  }

  if (!userId) throw new Error("userId is required");
  await dalDeactivateUser(session, userId);

  revalidatePath(`/${orgSlug}/admin/users`);
  revalidatePath(`/${orgSlug}/admin/users/${userId}`);
}

// ---------------------------------------------------------------------------
// changeUserRole
// ---------------------------------------------------------------------------

export async function changeUserRole(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const userId = formData.get("userId") as string | null;
  const newRoleId = formData.get("roleId") as string | null;
  const session = await requireSession(orgSlug ?? "");

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (e) {
    if (e instanceof ForbiddenError) throw new Error("Forbidden: missing MANAGE_USERS permission");
    throw e;
  }

  if (!userId || !newRoleId) throw new Error("userId and roleId are required");
  await dalChangeUserRole(session, userId, newRoleId);

  revalidatePath(`/${orgSlug}/admin/users`);
  revalidatePath(`/${orgSlug}/admin/users/${userId}`);
}

// ---------------------------------------------------------------------------
// setUserPassword
// ---------------------------------------------------------------------------

/**
 * Admin-set password.  The password is never logged, echoed, or returned.
 */
export async function setUserPassword(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const userId = formData.get("userId") as string | null;
  const newPassword = formData.get("password") as string | null;
  const session = await requireSession(orgSlug ?? "");

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (e) {
    if (e instanceof ForbiddenError) throw new Error("Forbidden: missing MANAGE_USERS permission");
    throw e;
  }

  if (!userId || !newPassword) throw new Error("userId and password are required");
  await dalSetUserPassword(session, userId, newPassword);

  revalidatePath(`/${orgSlug}/admin/users/${userId}`);
  redirect(`/${orgSlug}/admin/users/${userId}`);
}
