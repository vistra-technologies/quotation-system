"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export type CreatePermissionState = { error: string | null };

/**
 * Create a new global Permission row.
 *
 * Permission is GLOBAL — no organizationId, no tenancy filter.
 * A permission created here is visible in every org's catalog.
 *
 * Gate: MANAGE_FEATURES (server-side, always checked — not just the page).
 *
 * Duplicate code: the DB unique index on Permission.code raises P2002.
 * We catch it and return a user-readable error rather than letting it 500.
 *
 * ⚠ Creating a Permission row grants NO capability. It only takes effect
 * once a developer adds requirePermission(session, "<code>") in code.
 * Surface this caveat prominently in the UI (handled by the calling page).
 */
export async function createPermission(
  prevState: CreatePermissionState,
  formData: FormData
): Promise<CreatePermissionState> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const session = await getSession();
  if (!session) {
    redirect(orgSlug ? `/${orgSlug}/login` : "/");
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { error: "Forbidden: missing MANAGE_FEATURES permission" };
    }
    throw e;
  }

  const code = (formData.get("code") as string | null)?.trim().toUpperCase() ?? "";
  const description = (formData.get("description") as string | null)?.trim() ?? "";

  if (!code) {
    return { error: "Permission code is required" };
  }
  if (!description) {
    return { error: "Description is required" };
  }

  try {
    await prisma.permission.create({ data: { code, description } });
  } catch (e: unknown) {
    // P2002 = unique constraint violation — code already exists in the global catalog
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      return { error: `Permission code "${code}" already exists` };
    }
    throw e;
  }

  revalidatePath(`/${orgSlug}/admin/permissions`);
  redirect(`/${orgSlug}/admin/permissions`);
}
