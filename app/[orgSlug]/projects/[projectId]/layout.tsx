import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { orgHref, detectIsSubdomain } from "@/lib/orgHref";
import { fetchProjectDetail } from "./_project-fetch";
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
 * Auth gate: calls fetchProjectDetail() which hits the API route; a 401 response
 * means no session → redirect to login; any other non-200 means project not found
 * → 404.
 *
 * Stage 12: switched from direct requireSession + getProjectById DAL calls to
 * internalFetch via the shared React.cache()-wrapped fetchProjectDetail helper.
 * The layout and its child page share one HTTP round-trip per render pass.
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

  // Compute once on the server; forwarded to ProjectWizardBreadcrumb as a prop
  // to eliminate the useOrgHref client-side window.location.hostname read and
  // the resulting SSR/hydration mismatch (same fix applied to sidebar.tsx).
  const isSubdomain = await detectIsSubdomain(orgSlug);
  const base = await orgHref(orgSlug, "");

  const { status, project } = await fetchProjectDetail(orgSlug, projectId);

  if (status === 401 || status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!project) {
    notFound();
  }

  return (
    <div className="flex flex-col">
      {/* Back to projects list — rendered above the breadcrumb so it is always
          accessible regardless of which wizard step is active (item 5, Stage 15
          UI-pass fixes). */}
      <div className="px-8 pt-5">
        <Link
          href={`${base}/projects`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
        >
          ← Back to Projects
        </Link>
      </div>

      {/* Wizard breadcrumb — persists across all project sub-routes */}
      <ProjectWizardBreadcrumb orgSlug={orgSlug} projectId={projectId} isSubdomain={isSubdomain} />

      {/* Page content */}
      <div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>
    </div>
  );
}
