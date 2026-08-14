"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// ---------------------------------------------------------------------------
// createUser
// ---------------------------------------------------------------------------

export type CreateUserState = { error: string | null };

/**
 * Create a new user within the session's org.
 *
 * Thin marshaler (Stage 12): parses FormData, delegates to
 * POST /api/v1/orgs/[orgSlug]/users via internalFetch.
 * All tenancy enforcement and business logic live in the route handler.
 *
 * Uses the useActionState signature so the client form can surface errors
 * (e.g. duplicate username) rather than crashing to an error boundary.
 */
export async function createUser(
  prevState: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const firstName = (formData.get("firstName") as string | null)?.trim();
  const lastName = (formData.get("lastName") as string | null)?.trim();
  const username = (formData.get("username") as string | null)?.trim();
  const roleId = formData.get("roleId") as string | null;
  const externalCompanyId =
    (formData.get("externalCompanyId") as string | null) || null;
  const password = formData.get("password") as string | null;
  const mobile =
    (formData.get("mobile") as string | null)?.trim() || null;
  const profileEmail =
    (formData.get("profileEmail") as string | null)?.trim() || null;

  if (!firstName || !lastName) {
    return { error: "First name and last name are required" };
  }
  if (!username || !roleId || !password) {
    return { error: "Username, role, and password are required" };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }

  const res = await internalFetch(`/api/v1/orgs/${orgSlug}/users`, {
    method: "POST",
    body: JSON.stringify({
      username,
      firstName,
      lastName,
      mobile,
      profileEmail,
      roleId,
      externalCompanyId,
      password,
    }),
  });

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
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

  revalidatePath(`/${orgSlug}/admin/users`);
  redirect(await orgHref(orgSlug, "/admin/users"), RedirectType.replace);
}

// ---------------------------------------------------------------------------
// activateUser / deactivateUser
// ---------------------------------------------------------------------------

/**
 * Activate a user (sets active = true).
 *
 * Thin marshaler (Stage 12): delegates to
 * POST /api/v1/orgs/[orgSlug]/users/[userId]/activate via internalFetch.
 * All tenancy enforcement and RBAC live in the route handler.
 */
export async function activateUser(formData: FormData): Promise<void> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const userId = formData.get("userId") as string | null;

  if (!userId) throw new Error("userId is required");

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/users/${userId}/activate`,
    { method: "POST" },
  );

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!res.ok) {
    let errorMessage = "An unexpected error occurred — please try again.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(errorMessage);
  }

  revalidatePath(`/${orgSlug}/admin/users`);
  revalidatePath(`/${orgSlug}/admin/users/${userId}`);
}

/**
 * Deactivate a user (sets active = false).
 *
 * Thin marshaler (Stage 12): delegates to
 * POST /api/v1/orgs/[orgSlug]/users/[userId]/deactivate via internalFetch.
 * All tenancy enforcement and RBAC live in the route handler.
 *
 * Self-deactivation guard: the route handler catches the DAL's
 * "You cannot deactivate your own account" throw and returns 400.
 * On 400 here we throw (error boundary) since the UI already disables
 * the deactivate button for isSelf === true — this is a defense-in-depth
 * fallback scenario only.
 */
export async function deactivateUser(formData: FormData): Promise<void> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const userId = formData.get("userId") as string | null;

  if (!userId) throw new Error("userId is required");

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/users/${userId}/deactivate`,
    { method: "POST" },
  );

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!res.ok) {
    let errorMessage = "An unexpected error occurred — please try again.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(errorMessage);
  }

  revalidatePath(`/${orgSlug}/admin/users`);
  revalidatePath(`/${orgSlug}/admin/users/${userId}`);
}

// ---------------------------------------------------------------------------
// changeUserRole
// ---------------------------------------------------------------------------

/**
 * Change a user's role.
 *
 * Thin marshaler (Stage 12): delegates to
 * PATCH /api/v1/orgs/[orgSlug]/users/[userId]/role via internalFetch.
 * All tenancy enforcement and RBAC live in the route handler.
 */
export async function changeUserRole(formData: FormData): Promise<void> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const userId = formData.get("userId") as string | null;
  const newRoleId = formData.get("roleId") as string | null;

  if (!userId || !newRoleId) throw new Error("userId and roleId are required");

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/users/${userId}/role`,
    {
      method: "PATCH",
      body: JSON.stringify({ roleId: newRoleId }),
    },
  );

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!res.ok) {
    let errorMessage = "An unexpected error occurred — please try again.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(errorMessage);
  }

  revalidatePath(`/${orgSlug}/admin/users`);
  revalidatePath(`/${orgSlug}/admin/users/${userId}`);
}

// ---------------------------------------------------------------------------
// setUserPassword
// ---------------------------------------------------------------------------

/**
 * Admin-set password for a user. The password is never logged, echoed, or returned.
 *
 * Thin marshaler (Stage 12): delegates to
 * POST /api/v1/orgs/[orgSlug]/users/[userId]/password via internalFetch.
 * All tenancy enforcement and RBAC live in the route handler.
 */
export async function setUserPassword(formData: FormData): Promise<void> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const userId = formData.get("userId") as string | null;
  const newPassword = formData.get("password") as string | null;

  if (!userId || !newPassword) throw new Error("userId and password are required");

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/users/${userId}/password`,
    {
      method: "POST",
      body: JSON.stringify({ password: newPassword }),
    },
  );

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!res.ok) {
    let errorMessage = "An unexpected error occurred — please try again.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(errorMessage);
  }

  revalidatePath(`/${orgSlug}/admin/users/${userId}`);
  redirect(
    await orgHref(orgSlug, `/admin/users/${userId}`),
    RedirectType.replace,
  );
}

// ---------------------------------------------------------------------------
// updateUserProfile
// ---------------------------------------------------------------------------

export type UpdateUserProfileState = { error: string | null; success: boolean };

/**
 * Update editable profile fields for a user.
 *
 * Thin marshaler (Stage 15 Batch G — U4): parses FormData, delegates to
 * PUT /api/v1/orgs/[orgSlug]/users/[userId]/profile via internalFetch.
 * All tenancy enforcement and business logic live in the route handler.
 *
 * Uses the useActionState signature so the client form can surface errors
 * without crashing to an error boundary.
 */
export async function updateUserProfile(
  prevState: UpdateUserProfileState,
  formData: FormData,
): Promise<UpdateUserProfileState> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const userId = (formData.get("userId") as string | null) ?? "";

  const firstName = (formData.get("firstName") as string | null)?.trim();
  const lastName = (formData.get("lastName") as string | null)?.trim();
  const mobile =
    (formData.get("mobile") as string | null)?.trim() || null;
  const profileEmail =
    (formData.get("profileEmail") as string | null)?.trim() || null;
  const externalCompanyId =
    (formData.get("externalCompanyId") as string | null) || null;

  if (!firstName) return { error: "First name is required", success: false };
  if (!lastName) return { error: "Last name is required", success: false };

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/users/${userId}/profile`,
    {
      method: "PUT",
      body: JSON.stringify({
        firstName,
        lastName,
        mobile,
        profileEmail,
        externalCompanyId,
      }),
    },
  );

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!res.ok) {
    let errorMessage = "An unexpected error occurred — please try again.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // ignore JSON parse failure
    }
    return { error: errorMessage, success: false };
  }

  revalidatePath(`/${orgSlug}/admin/users/${userId}`);
  return { error: null, success: true };
}

// ---------------------------------------------------------------------------
// deleteUser
// ---------------------------------------------------------------------------

/**
 * Delete a user from the org.
 *
 * Thin marshaler (Stage 12 Batch 7g): delegates to
 * DELETE /api/v1/orgs/[orgSlug]/users/[userId] via internalFetch.
 * All tenancy enforcement and business logic live in the route handler.
 *
 * Throws on error so the caller (DeleteUserButton) can surface it.
 * The route handler returns 400 for expected rejection cases (self-delete,
 * FK constraint) — these throw with the server's descriptive message.
 */
export async function deleteUser(formData: FormData): Promise<void> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const userId = formData.get("userId") as string | null;

  if (!userId) throw new Error("userId is required");

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/users/${userId}`,
    { method: "DELETE" },
  );

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!res.ok) {
    let errorMessage = "An unexpected error occurred — please try again.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(errorMessage);
  }

  revalidatePath(`/${orgSlug}/admin/users`);
}
