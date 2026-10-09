import { redirect } from "next/navigation";

/**
 * Old flat URL, kept as a thin redirect (Stage 29 S29-3) so bookmarks keep working and the
 * page stays in the regression coverage map.
 *
 *   /controls/roles?orgId=X[&roleId=Y] → /controls/orgs/X/roles[?roleId=Y]
 *   /controls/roles                    → /controls/workspace
 */
export default async function LegacyRolesPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; roleId?: string }>;
}) {
  const { orgId, roleId } = await searchParams;
  if (!orgId) redirect("/controls/workspace");
  const qs = roleId ? `?roleId=${encodeURIComponent(roleId)}` : "";
  redirect(`/controls/orgs/${encodeURIComponent(orgId)}/roles${qs}`);
}
