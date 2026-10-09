"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { withAction } from "@/lib/with-route";

// Server actions for SuperAdmin account management (hotfix 2026-10-02). Thin marshalers over
// /api/v1/superadmin/admins — validation, hashing, guards and audit rows live in the route + DAL.

export type AdminFormState = { error: string | null; ok?: boolean };

async function errorFrom(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // ignore JSON parse failure
  }
  return "An unexpected error occurred — please try again.";
}

function readPasswords(formData: FormData): { password: string; error: string | null } {
  const password = (formData.get("password") as string | null) ?? "";
  const confirm = (formData.get("confirmPassword") as string | null) ?? "";
  if (!password) return { password, error: "Password is required" };
  if (password.length < 8) return { password, error: "Password must be at least 8 characters" };
  if (password !== confirm) return { password, error: "Passwords do not match" };
  return { password, error: null };
}

export const addSuperAdmin = withAction(
  "app/controls/(authenticated)/users/admin-actions#addSuperAdmin",
  async (
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> => {
  const username = ((formData.get("username") as string | null) ?? "").trim().toLowerCase();
  if (!username) return { error: "Username is required" };
  const { password, error } = readPasswords(formData);
  if (error) return { error };

  const res = await internalFetch("/api/v1/superadmin/admins", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (res.status === 401) redirect("/controls/login");
  if (!res.ok) return { error: await errorFrom(res) };

  revalidatePath("/controls/admins");
  return { error: null, ok: true };
});

export const changeSuperAdminPassword = withAction(
  "app/controls/(authenticated)/users/admin-actions#changeSuperAdminPassword",
  async (
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> => {
  const adminId = (formData.get("adminId") as string | null)?.trim();
  if (!adminId) return { error: "SuperAdmin ID is missing" };
  const { password, error } = readPasswords(formData);
  if (error) return { error };

  const res = await internalFetch(`/api/v1/superadmin/admins/${encodeURIComponent(adminId)}`, {
    method: "PATCH",
    body: JSON.stringify({ newPassword: password }),
  });
  if (res.status === 401) redirect("/controls/login");
  if (!res.ok) return { error: await errorFrom(res) };

  revalidatePath("/controls/admins");
  return { error: null, ok: true };
});

/** Throws on error so the caller (DeleteSuperAdminButton) can surface it in its ConfirmDialog. */
export const deleteSuperAdmin = withAction(
  "app/controls/(authenticated)/users/admin-actions#deleteSuperAdmin",
  async (formData: FormData): Promise<void> => {
  const adminId = (formData.get("adminId") as string | null)?.trim();
  if (!adminId) throw new Error("SuperAdmin ID is missing");

  const res = await internalFetch(`/api/v1/superadmin/admins/${encodeURIComponent(adminId)}`, {
    method: "DELETE",
  });
  if (res.status === 401) redirect("/controls/login");
  if (!res.ok) throw new Error(await errorFrom(res));

  revalidatePath("/controls/admins");
});
