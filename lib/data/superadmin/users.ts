// superadmin-only — intentionally cross-org
// This file belongs to the SuperAdmin data-access layer (lib/data/superadmin/).
// Functions here INTENTIONALLY omit organizationId filters — they operate across all orgs.
// This is the only directory in lib/data/ where cross-org queries are permitted.
// See Stage 16 architecture rule 1 in profile.md.

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { toAuthEmail } from "@/lib/auth-utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  mobile: string | null;
  profileEmail: string | null;
  active: boolean;
  role: { id: string; name: string };
}

export type CreateUserInOrgInput = {
  username: string;
  firstName: string;
  lastName: string;
  mobile: string | null;
  profileEmail: string | null;
  roleId: string;
  externalCompanyId: string | null;
  password: string;
};

export type CreateUserInOrgResult =
  | { ok: true; user: { id: string; username: string } }
  | {
      ok: false;
      reason:
        | "org_not_found"
        | "role_not_in_org"
        | "company_not_in_org"
        | "company_required"
        | "duplicate_username"
        | "unknown_error";
      message: string;
    };

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * List all users in the given org, A→Z by username, with role name.
 * Cross-org by design — called from the SuperAdmin console.
 *
 * superadmin-only — intentionally cross-org
 */
export async function listUsersInOrg(orgId: string): Promise<UserRow[]> {
  // superadmin-only — intentionally cross-org
  return prisma.user.findMany({
    where: { organizationId: orgId },
    orderBy: { username: "asc" },
    select: {
      id: true,
      username: true,
      firstName: true,
      lastName: true,
      mobile: true,
      profileEmail: true,
      active: true,
      role: { select: { id: true, name: true } },
    },
  });
}

/**
 * List all external companies in the given org, A→Z by name.
 * Used by the SuperAdmin add-user form to populate the External Company dropdown.
 *
 * superadmin-only — intentionally cross-org
 */
export async function listExternalCompaniesInOrg(
  orgId: string,
): Promise<{ id: string; name: string }[]> {
  // superadmin-only — intentionally cross-org
  return prisma.externalCompany.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new user + better-auth credential account in the given org.
 *
 * Cross-org: takes an explicit orgId instead of a session.
 * Caller (the route handler) must have already verified:
 *   - The roleId belongs to the target org (tenancy invariant).
 *   - The externalCompanyId (if any) belongs to the target org (tenancy invariant).
 *
 * Returns { ok: true, user: { id, username } } on success.
 * Returns { ok: false, reason, message } on known failure.
 *
 * superadmin-only — intentionally cross-org
 */
export async function createUserInOrg(
  orgId: string,
  input: CreateUserInOrgInput,
): Promise<CreateUserInOrgResult> {
  // superadmin-only — intentionally cross-org

  // Look up the org's slug to build the synthetic auth email.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { slug: true },
  });
  if (!org) {
    return {
      ok: false,
      reason: "org_not_found",
      message: `Organization "${orgId}" not found`,
    };
  }

  // Tenancy invariant: the roleId must belong to the target org.
  // Even in a SuperAdmin context we must not allow role IDs from other orgs.
  const role = await prisma.role.findFirst({
    where: { id: input.roleId, organizationId: orgId },
    select: { id: true, isInternalRole: true },
  });
  if (!role) {
    return {
      ok: false,
      reason: "role_not_in_org",
      message: "roleId does not belong to this organization",
    };
  }

  // Tenancy invariant: externalCompanyId (if provided) must belong to the target org.
  if (input.externalCompanyId) {
    const ec = await prisma.externalCompany.findFirst({
      where: { id: input.externalCompanyId, organizationId: orgId },
      select: { id: true },
    });
    if (!ec) {
      return {
        ok: false,
        reason: "company_not_in_org",
        message: "externalCompanyId does not belong to this organization",
      };
    }
  }

  // U3 enforcement: external roles require an external company.
  if (!role.isInternalRole && !input.externalCompanyId) {
    return {
      ok: false,
      reason: "company_required",
      message: "External company is required for this role",
    };
  }

  // Username uniqueness check within the org (before entering the transaction).
  const existing = await prisma.user.findFirst({
    where: { organizationId: orgId, username: input.username },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false,
      reason: "duplicate_username",
      message: `Username "${input.username}" is already taken in this organization`,
    };
  }

  // Build the synthetic auth email: {username}@{orgSlug}.internal
  const synthEmail = toAuthEmail(input.username, org.slug);

  // Hash with better-auth's own hasher (Scrypt) — identical to lib/data/users.ts:106-107.
  const authCtx = await auth.$context;
  const passwordHash = await authCtx.password.hash(input.password);

  try {
    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: `${input.firstName} ${input.lastName}`,
          email: synthEmail,
          emailVerified: false,
          organizationId: orgId,
          username: input.username,
          firstName: input.firstName,
          lastName: input.lastName,
          mobile: input.mobile ?? null,
          profileEmail: input.profileEmail ?? null,
          active: true,
          roleId: input.roleId,
          externalCompanyId: input.externalCompanyId ?? null,
        },
        select: { id: true, username: true },
      });

      await tx.account.create({
        data: {
          userId: user.id,
          providerId: "credential",
          accountId: user.id,
          password: passwordHash,
        },
      });

      return user;
    });

    return { ok: true, user: { id: newUser.id, username: newUser.username } };
  } catch (err) {
    // Prisma unique-constraint violation — most likely the synthetic email (username in use).
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return {
        ok: false,
        reason: "duplicate_username",
        message: `Username "${input.username}" is already taken in this organization`,
      };
    }
    return {
      ok: false,
      reason: "unknown_error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
