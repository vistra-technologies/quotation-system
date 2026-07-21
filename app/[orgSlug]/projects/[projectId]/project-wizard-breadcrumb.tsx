"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

interface ProjectWizardBreadcrumbProps {
  orgSlug: string;
  projectId: string;
}

/**
 * Project wizard breadcrumb — 5-step horizontal nav (Client Component).
 *
 * Uses usePathname() to determine the active step. Step 1 (Project Details)
 * uses exact-match; steps 2–5 use startsWith-match so nested routes (e.g.
 * design/add-wall) highlight the correct step.
 *
 * Wireframe-stage: plain horizontal list, no animation. Visual polish deferred.
 *
 * namespace: "wizard" — wired in app/[orgSlug]/projects/layout.tsx clientMessages.
 */
export function ProjectWizardBreadcrumb({ orgSlug, projectId }: ProjectWizardBreadcrumbProps) {
  const t = useTranslations("wizard");
  const pathname = usePathname();

  const base = `/${orgSlug}/projects/${projectId}`;

  const steps = [
    { label: t("step1"), href: base, exact: true },
    { label: t("step2"), href: `${base}/configuration`, exact: false },
    { label: t("step3"), href: `${base}/design`, exact: false },
    { label: t("step4"), href: `${base}/summary`, exact: false },
    { label: t("step5"), href: `${base}/quotation`, exact: false },
  ];

  return (
    <nav
      aria-label="Project wizard steps"
      className="border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <ol className="flex items-center gap-1 text-sm">
        {steps.map((step, index) => {
          const isActive = step.exact
            ? pathname === step.href
            : pathname.startsWith(step.href);

          return (
            <li key={step.href} className="flex items-center gap-1">
              {index > 0 && (
                <span className="text-zinc-300 dark:text-zinc-700" aria-hidden="true">
                  /
                </span>
              )}
              <Link
                href={step.href}
                className={
                  isActive
                    ? "font-semibold text-zinc-900 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                }
                aria-current={isActive ? "step" : undefined}
              >
                {step.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
