"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

interface ProjectWizardBreadcrumbProps {
  orgSlug: string;
  projectId: string;
  /** Forwarded from the server layout — true when the request arrived via an
   * org subdomain (e.g. acme.easeetool.com).  Eliminates the client-side
   * window.location.hostname read and the resulting SSR/hydration mismatch. */
  isSubdomain: boolean;
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
export function ProjectWizardBreadcrumb({ orgSlug, projectId, isSubdomain }: ProjectWizardBreadcrumbProps) {
  const t = useTranslations("wizard");
  const pathname = usePathname();

  // base: org-prefixed path, used only for step.href (kept for link construction).
  // In subdomain mode, usePathname() returns the path WITHOUT the org-slug prefix
  // (e.g. /projects/{id}/configuration, not /acme-glass/projects/{id}/configuration),
  // so active-step detection must compare against hrefBase (path-only in subdomain
  // mode, org-prefixed in path mode) — see activeIndex below.
  const base = `/${orgSlug}/projects/${projectId}`;
  // hrefBase: user-facing href — uses the server-computed isSubdomain flag so
  // the correct href is rendered in the SSR HTML without a hydration mismatch.
  const hrefBase = isSubdomain ? `/projects/${projectId}` : `/${orgSlug}/projects/${projectId}`;

  const steps = [
    { label: t("step1"), href: base, linkHref: hrefBase },
    { label: t("step2"), href: `${base}/configuration`, linkHref: `${hrefBase}/configuration` },
    { label: t("step3"), href: `${base}/design`, linkHref: `${hrefBase}/design` },
    { label: t("step4"), href: `${base}/summary`, linkHref: `${hrefBase}/summary` },
    { label: t("step5"), href: `${base}/quotation`, linkHref: `${hrefBase}/quotation` },
  ];

  // Derive the active index so earlier steps can be shown as "done".
  // Uses step.linkHref (which equals hrefBase-derived paths) to match against
  // usePathname()'s output. In subdomain mode, usePathname() returns paths without
  // the org-slug prefix (e.g. /projects/{id}/configuration); step.linkHref also
  // omits it in that mode. In path mode both are org-prefixed — identical behaviour.
  // Step 1 (index 0) uses a startsWith match combined with a negative check that
  // none of steps 2–5's hrefs also match — so /edit and other step-1 sub-routes
  // highlight Step 1 rather than leaving the breadcrumb unhighlighted (activeIndex -1).
  const activeIndex = steps.findIndex((step, i) => {
    if (i === 0) {
      return (
        pathname.startsWith(step.linkHref) &&
        !steps.slice(1).some((s) => pathname.startsWith(s.linkHref))
      );
    }
    return pathname.startsWith(step.linkHref);
  });

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
