import { NextIntlClientProvider } from "next-intl";
import allMessages from "@/messages/en.json";

/**
 * Projects section layout (Server Component).
 *
 * Provides NextIntlClientProvider so Client Components under this layout
 * (e.g. CreateProjectForm) can use useTranslations().
 *
 * Auth is NOT gated here — each page handles its own requireSession() call,
 * because the project list is accessible to any authenticated user without
 * a special permission, unlike the admin section.
 *
 * Only the `projects` namespace is forwarded to the client — the full
 * messages/en.json is never sent wholesale.
 */
export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const clientMessages = {
    common: allMessages.common,
    projects: allMessages.projects,
    selections: allMessages.selections,
    // Stage 8: AddWallForm under projects/[projectId]/design/ uses this namespace.
    design: allMessages.design,
    // Stage 9: ProjectWizardBreadcrumb under projects/[projectId]/* uses this namespace.
    wizard: allMessages.wizard,
    // Stage 10: Toast primitive used on placeholder buttons across project pages.
    toast: allMessages.toast,
  };

  // S21 padding fix (round 3): this wrapper used to carry the shared
  // max-w-[1180px] px-8 pt-7 pb-4 box that suits narrow form pages, but the
  // Design page needs the full width + minimal padding the mockup uses and
  // was silently inheriting this cap too (squeezing its 3-column grid to
  // ~1116px and blocking it from stretching to fill the viewport height).
  // The wrapper is now owned by each leaf that wants it: the list page and
  // "new project" page apply it directly on their own root element; the
  // [projectId] wizard-step pages apply it via WizardPageShell, which
  // renders a different (unconstrained, height-stretching) box specifically
  // for the design route. This layout now only provides i18n context.
  return (
    <NextIntlClientProvider messages={clientMessages}>
      {children}
    </NextIntlClientProvider>
  );
}
