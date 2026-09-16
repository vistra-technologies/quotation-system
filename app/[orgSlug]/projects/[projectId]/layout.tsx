import { notFound, redirect } from "next/navigation";
import { orgHref, detectIsSubdomain } from "@/lib/orgHref";
import { fetchProjectDetail } from "./_project-fetch";
import { WizardPageShell } from "./wizard-page-shell";

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

  const { status, project } = await fetchProjectDetail(orgSlug, projectId);

  if (status === 401 || status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!project) {
    notFound();
  }

  // S21 padding fix (round 3): WizardPageShell now owns both the breadcrumb
  // and the box around {children}, since which box to use (the narrow/padded
  // one every other step wants, vs the full-width/height-stretching one
  // Design wants) depends on which step is active — see its own comment.
  // Replaces the old flat "flex flex-col" wrapper + bare children div, and
  // subsumes the S21-0.2 note above (Design's height-stretch is now handled
  // by WizardPageShell's design branch instead of by removing py-8 here).
  return (
    <WizardPageShell
      orgSlug={orgSlug}
      projectId={projectId}
      isSubdomain={isSubdomain}
      selectionCount={project.selectionCount}
      partitionCount={project.partitionCount}
    >
      {children}
    </WizardPageShell>
  );
}
