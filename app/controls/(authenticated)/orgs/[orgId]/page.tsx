import { redirect } from "next/navigation";

/**
 * /controls/orgs/[orgId] has no content of its own: the workspace lands on the Overview tab (S29-2).
 */
export default async function OrgWorkspaceIndexPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  redirect(`/controls/orgs/${encodeURIComponent(orgId)}/overview`);
}
