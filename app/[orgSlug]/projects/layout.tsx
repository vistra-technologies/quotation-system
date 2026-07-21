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
  };

  return (
    <NextIntlClientProvider messages={clientMessages}>
      <div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>
    </NextIntlClientProvider>
  );
}
