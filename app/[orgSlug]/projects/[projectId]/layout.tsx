import { notFound } from "next/navigation";
import { requireSession } from "@/lib/data/session";
import { getProjectById } from "@/lib/data/projects";
import { ProjectWizardBreadcrumb } from "./project-wizard-breadcrumb";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Project-level wizard shell layout (Server Component).
 *
 * Wraps every page under /[orgSlug]/projects/[projectId]/* with a persistent
 * 5-step breadcrumb. Steps: Project Details → Configuration → Design →
 * Summary → Quotation.
 *
 * Auth gate: requireSession — same as each child page. The layout runs its
 * own check so an unauthenticated request gets a 401/redirect before
 * rendering any child content.
 *
 * Tenancy guard: getProjectById scoped to session.organizationId; returns
 * null for missing or cross-org projects → 404.
 *
 * NOTE: This layout is a Server Component and does NOT wrap with its own
 * NextIntlClientProvider. The "wizard" namespace is forwarded to the client
 * by the nearest ancestor that does — app/[orgSlug]/projects/layout.tsx —
 * so ProjectWizardBreadcrumb (a client component calling useTranslations("wizard"))
 * receives it correctly.
 */
export default async function ProjectWizardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const session = await requireSession(orgSlug);

  const project = await getProjectById(session, projectId);

  // Tenancy guard: project not found or belongs to a different org.
  if (!project) notFound();

  return (
    <div className="flex flex-col">
      {/* Wizard breadcrumb — persists across all project sub-routes */}
      <ProjectWizardBreadcrumb orgSlug={orgSlug} projectId={projectId} />

      {/* Page content */}
      <div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>
    </div>
  );
}
