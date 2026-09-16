"use client";

import { usePathname } from "next/navigation";
import { ProjectWizardBreadcrumb } from "./project-wizard-breadcrumb";

interface WizardPageShellProps {
  orgSlug: string;
  projectId: string;
  isSubdomain: boolean;
  selectionCount: number;
  partitionCount: number;
  children: React.ReactNode;
}

/**
 * Wraps the wizard breadcrumb + the active step's content (Client Component,
 * since picking the right box depends on usePathname()).
 *
 * Every wizard step except Design wants the narrow, padded, non-stretching
 * box that used to live in projects/layout.tsx (moved here so it can be
 * withheld from exactly one route without duplicating breadcrumb rendering
 * or touching the other four steps' markup). Design wants the opposite: full
 * width (its own grid caps at 1480px, matching the mockup) and a height that
 * actually stretches to the viewport so its columns fill the page and scroll
 * internally instead of stopping at their content height with blank space
 * below (S21 padding fix, round 3).
 */
export function WizardPageShell({
  orgSlug,
  projectId,
  isSubdomain,
  selectionCount,
  partitionCount,
  children,
}: WizardPageShellProps) {
  const pathname = usePathname();
  const isDesign = pathname?.endsWith("/design") ?? false;

  return (
    <div
      className={
        isDesign
          ? "flex h-full min-h-0 w-full flex-1 flex-col"
          : "mx-auto flex h-full w-full max-w-[1180px] flex-col px-8 pb-4 pt-7"
      }
    >
      <ProjectWizardBreadcrumb
        orgSlug={orgSlug}
        projectId={projectId}
        isSubdomain={isSubdomain}
        selectionCount={selectionCount}
        partitionCount={partitionCount}
      />
      <div className={isDesign ? "flex min-h-0 flex-1 flex-col" : undefined}>
        {children}
      </div>
    </div>
  );
}
