import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { requirePermission, ForbiddenError } from "@/lib/rbac";

export type { SessionData } from "@/lib/session";

/**
 * Require an active, org-matched session; redirect to login otherwise.
 *
 * Replaces the hand-rolled `getAuthenticatedSession(orgSlug)` helper that
 * previously lived in each server action and page.
 */
export async function requireSession(orgSlug: string) {
  const session = await getSession();
  if (!session) redirect(orgSlug ? `/${orgSlug}/login` : "/");
  return session!;
}

/**
 * Assert the session holds the given RBAC permission; redirect to dashboard if not.
 *
 * Replaces the try/catch(ForbiddenError) → redirect pattern that was repeated
 * in every page that gates on a single permission.
 *
 * Note: for server actions that return error state (useActionState pattern)
 * rather than redirecting, keep the try/catch in the action itself — this
 * helper is for the pages-that-redirect variant only.
 */
export async function requirePermissionFor(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  permission: string,
  orgSlug: string,
): Promise<void> {
  try {
    await requirePermission(session, permission);
  } catch (e) {
    if (e instanceof ForbiddenError) redirect(`/${orgSlug}/dashboard`);
    throw e;
  }
}
