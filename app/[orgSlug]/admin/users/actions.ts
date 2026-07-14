"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { toAuthEmail } from "@/lib/auth-utils";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function getAuthenticatedSession(orgSlug: string | null) {
  const session = await getSession();
  if (!session) {
    redirect(orgSlug ? `/${orgSlug}/login` : "/");
  }
  return session;
}

async function enforceManageUsers(session: Awaited<ReturnType<typeof getSession>>) {
  try {
    await requirePermission(session!, PERMISSIONS.MANAGE_USERS);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      throw new Error("Forbidden: missing MANAGE_USERS permission");
    }
    throw e;
  }
}

/**
 * Tenancy guard: verify target user exists within the session's org.
 * Returns the user row on success; throws a generic error on failure so
 * callers cannot distinguish "not found" from "access denied".
 */
async function requireUserInOrg(userId: string, organizationId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true },
  });
  if (!user) throw new Error("User not found or access denied");
  return user;
}

// ---------------------------------------------------------------------------
// createUser
// ---------------------------------------------------------------------------

export type CreateUserState = { error: string | null };

/**
 * Create a new user within the session's org and wire up a better-auth
 * credential account using the canonical password-hashing pattern from
 * lib/auth.$context.password.hash() (profile §8).
 *
 * The user + account rows are created in a single $transaction so a partial
 * failure cannot leave a user with no way to log in.
 *
 * Uses the useActionState signature so the client form can surface errors
 * (e.g. duplicate username) instead of crashing to an error boundary.
 */
export async function createUser(
  prevState: CreateUserState,
  formData: FormData
): Promise<CreateUserState> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const session = await getAuthenticatedSession(orgSlug);
  await enforceManageUsers(session);

  const username = (formData.get("username") as string | null)?.trim();
  const roleId = formData.get("roleId") as string | null;
  const externalCompanyId = (formData.get("externalCompanyId") as string | null) || null;
  const password = formData.get("password") as string | null;

  if (!username || !roleId || !password) {
    return { error: "Username, role, and password are required" };
  }

  // Ensure the chosen role belongs to the session's org (tenancy guard on FK).
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!role) throw new Error("Role not found or access denied");

  // If an external company was supplied, ensure it belongs to the session's org.
  if (externalCompanyId) {
    const ec = await prisma.externalCompany.findFirst({
      where: { id: externalCompanyId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!ec) throw new Error("External company not found or access denied");
  }

  // Uniqueness check within the org.
  const existing = await prisma.user.findFirst({
    where: { organizationId: session.organizationId, username },
    select: { id: true },
  });
  if (existing) return { error: `Username "${username}" is already taken in this organization` };

  // Fetch the org slug for the synthetic email.
  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { slug: true },
  });
  if (!org) throw new Error("Organization not found");

  const synthEmail = toAuthEmail(username, org.slug);

  // Hash the password using better-auth's own hasher (same Scrypt impl as sign-in).
  const authCtx = await auth.$context;
  const passwordHash = await authCtx.password.hash(password);

  // Create user + credential account atomically.
  await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        name: username,
        email: synthEmail,
        emailVerified: false,
        organizationId: session.organizationId,
        username,
        active: true,
        roleId,
        externalCompanyId: externalCompanyId ?? null,
      },
    });

    await tx.account.create({
      data: {
        userId: newUser.id,
        providerId: "credential",
        accountId: newUser.id,
        password: passwordHash,
      },
    });
  });

  revalidatePath(`/${orgSlug}/admin/users`);
  redirect(`/${orgSlug}/admin/users`);
}

// ---------------------------------------------------------------------------
// activateUser / deactivateUser
// ---------------------------------------------------------------------------

export async function activateUser(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const userId = formData.get("userId") as string | null;
  const session = await getAuthenticatedSession(orgSlug);
  await enforceManageUsers(session);

  if (!userId) throw new Error("userId is required");
  await requireUserInOrg(userId, session.organizationId);

  await prisma.user.update({ where: { id: userId }, data: { active: true } });

  revalidatePath(`/${orgSlug}/admin/users`);
  revalidatePath(`/${orgSlug}/admin/users/${userId}`);
}

export async function deactivateUser(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const userId = formData.get("userId") as string | null;
  const session = await getAuthenticatedSession(orgSlug);
  await enforceManageUsers(session);

  if (!userId) throw new Error("userId is required");
  await requireUserInOrg(userId, session.organizationId);

  // Prevent admins from deactivating themselves — they would be locked out
  // immediately (getSession() returns null for inactive users).
  if (userId === session.userId) {
    throw new Error("You cannot deactivate your own account");
  }

  await prisma.user.update({ where: { id: userId }, data: { active: false } });

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
  const session = await getAuthenticatedSession(orgSlug);
  await enforceManageUsers(session);

  if (!userId || !newRoleId) throw new Error("userId and roleId are required");
  await requireUserInOrg(userId, session.organizationId);

  // Verify the new role belongs to the session's org.
  const role = await prisma.role.findFirst({
    where: { id: newRoleId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!role) throw new Error("Role not found or access denied");

  await prisma.user.update({ where: { id: userId }, data: { roleId: newRoleId } });

  revalidatePath(`/${orgSlug}/admin/users`);
  revalidatePath(`/${orgSlug}/admin/users/${userId}`);
}

// ---------------------------------------------------------------------------
// setUserPassword
// ---------------------------------------------------------------------------

/**
 * Admin-set password: hashes the new password and writes it to the credential
 * account row.  The password is never logged, echoed, or returned.
 */
export async function setUserPassword(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const userId = formData.get("userId") as string | null;
  const newPassword = formData.get("password") as string | null;
  const session = await getAuthenticatedSession(orgSlug);
  await enforceManageUsers(session);

  if (!userId || !newPassword) throw new Error("userId and password are required");
  await requireUserInOrg(userId, session.organizationId);

  const authCtx = await auth.$context;
  const passwordHash = await authCtx.password.hash(newPassword);

  // Update the credential account row (profile §8, pattern 2b).
  await prisma.account.updateMany({
    where: { userId, providerId: "credential" },
    data: { password: passwordHash },
  });

  revalidatePath(`/${orgSlug}/admin/users/${userId}`);
  redirect(`/${orgSlug}/admin/users/${userId}`);
}
