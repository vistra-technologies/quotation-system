import { notFound } from "next/navigation";
import { loadWorkspaceOrg } from "../_org";
import { EditOrgForm } from "./edit-org-form";

// Always render live.
export const dynamic = "force-dynamic";

/**
 * Workspace Overview tab (Server Component).
 *
 * Name, read-only slug, created date, and suspend / reactivate. The formula-set picker lives on
 * the Formula & Pricing tab. (`userLimit` joins this form in Stage 29 Batch 2.)
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx.
 *
 * Moved from orgs/[orgId]/page.tsx (Stage 25 Batch 5) in Stage 29 Batch 1.
 */
export default async function OrgOverviewPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const org = await loadWorkspaceOrg(orgId);
  if (!org) notFound();

  return (
    <EditOrgForm
      orgId={org.id}
      initialName={org.name}
      slug={org.slug}
      isSuspended={org.isSuspended}
      createdLabel={org.createdAt.toISOString().slice(0, 10)}
    />
  );
}
