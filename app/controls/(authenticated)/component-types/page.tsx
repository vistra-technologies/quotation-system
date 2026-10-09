import { redirect } from "next/navigation";

/**
 * Old flat URL, kept as a thin redirect (Stage 29 S29-3) so bookmarks keep working and the
 * page stays in the regression coverage map.
 *
 *   /controls/component-types?orgId=X[&typeId=Y] → /controls/orgs/X/components[?typeId=Y]
 *   /controls/component-types                    → /controls/workspace
 */
export default async function LegacyComponentTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; typeId?: string }>;
}) {
  const { orgId, typeId } = await searchParams;
  if (!orgId) redirect("/controls/workspace");
  const qs = typeId ? `?typeId=${encodeURIComponent(typeId)}` : "";
  redirect(`/controls/orgs/${encodeURIComponent(orgId)}/components${qs}`);
}
