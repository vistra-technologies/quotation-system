"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { withAction } from "@/lib/with-route";
import { isValidPassword, PASSWORD_TOO_SHORT_MESSAGE } from "@/lib/user-validation";

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
export const createUser = withAction(
  "app/[orgSlug]/admin/users/actions#createUser",
  async (
  prevState: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> => {
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
  if (!isValidPassword(password)) {
    return { error: PASSWORD_TOO_SHORT_MESSAGE };
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
      const body = (await res.json()) as {
        error?: string;
        code?: string;
        limit?: number;
        current?: number;
      };
      if (body.error) errorMessage = body.error;
      // Stage 29: 409 USER_LIMIT_REACHED is surfaced as form state (never a 500).
      if (res.status === 409 && body.code === "USER_LIMIT_REACHED") {
        errorMessage = `User limit reached (${body.current}/${body.limit}). Contact your platform administrator.`;
      }
    } catch {
      // ignore JSON parse failure
    }
    return { error: errorMessage };
  }

  revalidatePath(`/${orgSlug}/admin/users`);
  redirect(await orgHref(orgSlug, "/admin/users"), RedirectType.replace);
});

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
export const activateUser = withAction(
  "app/[orgSlug]/admin/users/actions#activateUser",
  async (formData: FormData): Promise<void> => {
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
});

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
export const deactivateUser = withAction(
  "app/[orgSlug]/admin/users/actions#deactivateUser",
  async (formData: FormData): Promise<void> => {
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
});

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
export const changeUserRole = withAction(
  "app/[orgSlug]/admin/users/actions#changeUserRole",
  async (formData: FormData): Promise<void> => {
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
});

// ---------------------------------------------------------------------------
// setUserPasswordModal (H-18)
// ---------------------------------------------------------------------------

export type SetPasswordModalState = { error: string | null; success: boolean };

/**
 * Admin-set password for a user from within the Edit User modal.
 *
 * Returns state (no redirect) so the modal can show success/error inline.
 * Blank password is a no-op success — the caller's hint reads "Leave blank to
 * keep current password." All tenancy enforcement lives in the route handler.
 *
 * Hotfix 2026-09-28 H-18.
 */
export const setUserPasswordModal = withAction(
  "app/[orgSlug]/admin/users/actions#setUserPasswordModal",
  async (
  prevState: SetPasswordModalState,
  formData: FormData,
): Promise<SetPasswordModalState> => {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const userId = (formData.get("userId") as string | null) ?? "";
  const password = (formData.get("password") as string | null) ?? "";

  if (!userId) return { error: "User ID is missing", success: false };
  // Blank = keep current — treat as a no-op success so the form feedback is
  // consistent with the SA modal's behaviour (SA action skips the PATCH too).
  if (!password.trim()) return { error: null, success: true };
  if (!isValidPassword(password)) {
    return { error: PASSWORD_TOO_SHORT_MESSAGE, success: false };
  }

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/users/${userId}/password`,
    {
      method: "POST",
      body: JSON.stringify({ password }),
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

  revalidatePath(`/${orgSlug}/admin/users`);
  return { error: null, success: true };
});

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
export const setUserPassword = withAction(
  "app/[orgSlug]/admin/users/actions#setUserPassword",
  async (formData: FormData): Promise<void> => {
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
});

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
export const updateUserProfile = withAction(
  "app/[orgSlug]/admin/users/actions#updateUserProfile",
  async (
  prevState: UpdateUserProfileState,
  formData: FormData,
): Promise<UpdateUserProfileState> => {
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
  revalidatePath(`/${orgSlug}/admin/users`);
  return { error: null, success: true };
});

// ---------------------------------------------------------------------------
// reassignWork (Stage 31 S31-4a)
// ---------------------------------------------------------------------------

export type ReassignWorkState = {
  error: string | null;
  /** Counts moved by the last successful reassign; null before/without one. */
  moved: { projects: number; inquiries: number } | null;
};

/**
 * Move every project and inquiry created by one user to another active user of the org.
 *
 * Thin marshaler: delegates to POST /api/v1/orgs/[orgSlug]/users/[userId]/reassign-work via
 * internalFetch. Returns state (never throws) so the detail page shows the server's message
 * ("Target user cannot access N of these records", inactive target, ...) inline.
 */
export const reassignWork = withAction(
  "app/[orgSlug]/admin/users/actions#reassignWork",
  async (
  prevState: ReassignWorkState,
  formData: FormData,
): Promise<ReassignWorkState> => {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const userId = (formData.get("userId") as string | null) ?? "";
  const toUserId = (formData.get("toUserId") as string | null) ?? "";

  if (!userId) return { error: "User ID is missing", moved: null };
  if (!toUserId) return { error: "Choose who should receive the work", moved: null };

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/users/${userId}/reassign-work`,
    { method: "POST", body: JSON.stringify({ toUserId }) },
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
    return { error: errorMessage, moved: null };
  }

  const moved = (await res.json()) as { projects: number; inquiries: number };
  revalidatePath(`/${orgSlug}/admin/users`);
  revalidatePath(`/${orgSlug}/admin/users/${userId}`);
  revalidatePath(`/${orgSlug}/projects`);
  revalidatePath(`/${orgSlug}/inquiries`);
  return { error: null, moved };
});

// ---------------------------------------------------------------------------
// deleteUser
// ---------------------------------------------------------------------------

export type DeleteUserState = { error: string | null; success: boolean };

/**
 * Delete a user from the org. Never blocked by the user's records (Stage 31 S31-4): they stay,
 * attributed to a snapshot of the user's name.
 *
 * Thin marshaler (Stage 12 Batch 7g): delegates to
 * DELETE /api/v1/orgs/[orgSlug]/users/[userId] via internalFetch.
 * All tenancy enforcement and business logic live in the route handler.
 *
 * Returns state instead of throwing, so any remaining failure (self-delete, unknown id) shows in
 * the confirm dialog rather than as a generic 500 (a thrown server-action error reaches the client
 * with its message redacted in production).
 *
 * Optional `toUserId` (the dialog's "Reassign to..." picker): the work is reassigned first; if that
 * fails nothing is deleted and the reassign error is returned.
 */
export const deleteUser = withAction(
  "app/[orgSlug]/admin/users/actions#deleteUser",
  async (
  prevState: DeleteUserState,
  formData: FormData,
): Promise<DeleteUserState> => {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const userId = (formData.get("userId") as string | null) ?? "";
  const toUserId = (formData.get("toUserId") as string | null) ?? "";

  if (!userId) return { error: "User ID is missing", success: false };

  async function errorOf(res: Response): Promise<string> {
    let errorMessage = "An unexpected error occurred — please try again.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // ignore JSON parse failure
    }
    return errorMessage;
  }

  if (toUserId) {
    const moveRes = await internalFetch(
      `/api/v1/orgs/${orgSlug}/users/${userId}/reassign-work`,
      { method: "POST", body: JSON.stringify({ toUserId }) },
    );
    if (moveRes.status === 401 || moveRes.status === 403) {
      redirect(await orgHref(orgSlug, "/login"));
    }
    if (!moveRes.ok) return { error: await errorOf(moveRes), success: false };
  }

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/users/${userId}`,
    { method: "DELETE" },
  );

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!res.ok) return { error: await errorOf(res), success: false };

  revalidatePath(`/${orgSlug}/admin/users`);
  revalidatePath(`/${orgSlug}/projects`);
  revalidatePath(`/${orgSlug}/inquiries`);
  return { error: null, success: true };
});
