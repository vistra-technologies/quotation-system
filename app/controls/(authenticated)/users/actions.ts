"use server";

import { revalidatePath } from "next/cache";
import { internalFetch } from "@/lib/internal-fetch";
import { redirect } from "next/navigation";

// ─── addUser ─────────────────────────────────────────────────────────────────

/** `ok` is set on success so the add-user popup knows to close (hotfix 2026-09-25, H-5). */
export type AddUserState = { error: string | null; ok?: boolean };

/**
 * Add a new user to an organization from the SuperAdmin console.
 *
 * Thin marshaler (Stage 12 pattern): parses FormData, delegates to
 * POST /api/v1/superadmin/orgs/[orgId]/users via internalFetch.
 * All tenancy guards, password hashing, and audit log writes happen
 * in the route handler + DAL.
 *
 * Uses the useActionState signature so the client form can surface errors
 * (e.g. duplicate username) rather than crashing to an error boundary.
 */
export async function addUser(
  prevState: AddUserState,
  formData: FormData,
): Promise<AddUserState> {
  const orgId = (formData.get("orgId") as string | null)?.trim();
  const firstName = (formData.get("firstName") as string | null)?.trim();
  const lastName = (formData.get("lastName") as string | null)?.trim();
  const username = (formData.get("username") as string | null)?.trim();
  const roleId = (formData.get("roleId") as string | null)?.trim();
  const password = (formData.get("password") as string | null) ?? "";
  const mobile = (formData.get("mobile") as string | null)?.trim() || null;
  const profileEmail =
    (formData.get("profileEmail") as string | null)?.trim() || null;
  const externalCompanyId =
    (formData.get("externalCompanyId") as string | null)?.trim() || null;

  if (!orgId) return { error: "Organization ID is missing" };
  if (!firstName) return { error: "First name is required" };
  if (!lastName) return { error: "Last name is required" };
  if (!username) return { error: "Username is required" };
  if (!roleId) return { error: "Role is required" };
  if (!password) return { error: "Password is required" };
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }

  const res = await internalFetch(
    `/api/v1/superadmin/orgs/${encodeURIComponent(orgId)}/users`,
    {
      method: "POST",
      body: JSON.stringify({
        firstName,
        lastName,
        username,
        roleId,
        password,
        mobile,
        profileEmail,
        externalCompanyId,
      }),
    },
  );

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

  revalidatePath(`/controls/users`);
  return { error: null, ok: true };
}

// ─── editUser (hotfix 2026-09-25, H-5) ───────────────────────────────────────

export type EditUserState = { error: string | null; ok?: boolean };

/**
 * Edit an existing user from the SuperAdmin console.
 *
 * Thin marshaler: parses FormData and delegates to
 * PATCH /api/v1/superadmin/orgs/[orgId]/users/[userId]. Tenancy guards, hashing,
 * session revocation and the audit log live in the route + DAL. An empty
 * newPassword means "keep the current password".
 */
export async function editUser(
  prevState: EditUserState,
  formData: FormData,
): Promise<EditUserState> {
  const orgId = (formData.get("orgId") as string | null)?.trim();
  const userId = (formData.get("userId") as string | null)?.trim();
  const firstName = (formData.get("firstName") as string | null)?.trim();
  const lastName = (formData.get("lastName") as string | null)?.trim();
  const roleId = (formData.get("roleId") as string | null)?.trim();
  const active = formData.get("active") === "true";
  const mobile = (formData.get("mobile") as string | null)?.trim() || null;
  const profileEmail = (formData.get("profileEmail") as string | null)?.trim() || null;
  const newPassword = (formData.get("newPassword") as string | null) ?? "";

  if (!orgId || !userId) return { error: "User or organization ID is missing" };
  if (!firstName) return { error: "First name is required" };
  if (!lastName) return { error: "Last name is required" };
  if (!roleId) return { error: "Role is required" };
  if (newPassword && newPassword.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }

  const res = await internalFetch(
    `/api/v1/superadmin/orgs/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        firstName,
        lastName,
        roleId,
        active,
        mobile,
        profileEmail,
        ...(newPassword ? { newPassword } : {}),
      }),
    },
  );

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

  revalidatePath(`/controls/users`);
  return { error: null, ok: true };
}
