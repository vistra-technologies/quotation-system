import { notFound, redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import type { ConfigUpdatePreview } from "@/lib/config-update";
import { fetchProjectDetail } from "../_project-fetch";
import { UpdateConfigWizard } from "./update-config-wizard";

export const dynamic = "force-dynamic";

/** Update-configuration wizard (Hotfix 2026-10-01, H-6). DRAFT projects only. */
export default async function UpdateConfigurationPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const base = await orgHref(orgSlug, "");
  const [{ status, project }, previewRes] = await Promise.all([
    fetchProjectDetail(orgSlug, projectId),
    internalFetch(`/api/v1/orgs/${orgSlug}/projects/${projectId}/config-update`),
  ]);
  if (status === 401 || status === 403 || previewRes.status === 401 || previewRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }
  if (!project) notFound();
  if (project.status !== "DRAFT" || !previewRes.ok) redirect(`${base}/projects/${projectId}`);

  const preview = (await previewRes.json()) as ConfigUpdatePreview;
  return (
    <div className="py-8">
      <UpdateConfigWizard
        orgSlug={orgSlug}
        projectId={projectId}
        backHref={`${base}/projects/${projectId}`}
        preview={preview}
      />
    </div>
  );
}
