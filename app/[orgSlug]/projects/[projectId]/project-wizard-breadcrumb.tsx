"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useOrgHref } from "@/lib/useOrgHref";

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
 * Stage 10 (Task 1.6): restyled to Sage Ease pill stepper. Active step gets
 * bg-primary; completed steps show a checkmark and text-primary-dark; future
 * steps are text-text-muted. Logic, hrefs, and aria-current are unchanged.
 *
 * namespace: "wizard" — wired in app/[orgSlug]/projects/layout.tsx clientMessages.
 */
export function ProjectWizardBreadcrumb({ orgSlug, projectId }: ProjectWizardBreadcrumbProps) {
  const t = useTranslations("wizard");
  const pathname = usePathname();
  const orgHref = useOrgHref(orgSlug);

  // base: path-based (internal route), used for active-step detection.
  // usePathname() always returns the internal path-based route even in subdomain
  // mode, so active detection must compare against path-based strings.
  const base = `/${orgSlug}/projects/${projectId}`;
  // hrefBase: user-facing href, resolves to bare subpath on subdomain hosts.
  const hrefBase = orgHref(`/projects/${projectId}`);

  const steps = [
    { label: t("step1"), href: base, linkHref: hrefBase, exact: true },
    { label: t("step2"), href: `${base}/configuration`, linkHref: `${hrefBase}/configuration`, exact: false },
    { label: t("step3"), href: `${base}/design`, linkHref: `${hrefBase}/design`, exact: false },
    { label: t("step4"), href: `${base}/summary`, linkHref: `${hrefBase}/summary`, exact: false },
    { label: t("step5"), href: `${base}/quotation`, linkHref: `${hrefBase}/quotation`, exact: false },
  ];

  // Derive the active index so earlier steps can be shown as "done".
  // Uses step.href (path-based) to match against usePathname()'s internal route.
  const activeIndex = steps.findIndex((step) =>
    step.exact ? pathname === step.href : pathname.startsWith(step.href),
  );

  return (
    <nav aria-label="Project wizard steps" className="py-4">
      <ol className="mx-auto flex w-fit max-w-full items-center gap-1.5 rounded-pill bg-primary-softer p-2">
        {steps.map((step, index) => {
          const isActive = index === activeIndex;
          const isDone = activeIndex > -1 && index < activeIndex;

          // Build step link className based on state.
          const linkClass = isActive
            ? "flex items-center gap-2 rounded-pill bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary"
            : isDone
              ? "flex items-center gap-2 rounded-pill px-5 py-2.5 text-sm font-bold text-primary-dark"
              : "flex items-center gap-2 rounded-pill px-5 py-2.5 text-sm font-bold text-text-muted";

          return (
            <li key={step.href}>
              <Link
                href={step.linkHref}
                className={linkClass}
                aria-current={isActive ? "step" : undefined}
              >
                {/* Step indicator: checkmark when done, number otherwise */}
                {isDone ? (
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs text-primary"
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                ) : (
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                      isActive ? "bg-white/25" : "bg-white/60"
                    }`}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                )}
                <span className="whitespace-nowrap">{step.label}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
