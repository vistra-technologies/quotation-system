import { redirect } from "next/navigation";

/**
 * Old flat URL, kept as a thin redirect (Stage 29 S29-3) so bookmarks keep working and the
 * page stays in the regression coverage map.
 *
 *   /controls/users?orgId=X → /controls/orgs/X/users
 *   /controls/users         → /controls/workspace
 *
 * The SuperAdmin accounts section that used to live here is now /controls/admins (O-1).
 */
export default async function LegacyUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  redirect(orgId ? `/controls/orgs/${encodeURIComponent(orgId)}/users` : "/controls/workspace");
}
