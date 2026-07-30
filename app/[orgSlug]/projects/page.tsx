import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listProjects } from "@/lib/data/projects";
import { requireSession } from "@/lib/data/session";
import { orgHref } from "@/lib/orgHref";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Projects list page (Server Component).
 *
 * Lists all projects within the session's org, newest-first.
 * Auth-protected (any authenticated user); no special RBAC permission required.
 *
 * Stage 11 (Batch 4): restyled to Sage Ease tokens matching
 * project-list-page-2026-07-23-v1.html. Toolbar controls (date filter, search,
 * My/All segmented) are rendered as inert HTML — filtering is a future-stage
 * concern. No queries or behavior changed.
 */

/** Map a project status string to Sage Ease status-pill token classes. */
function statusClasses(status: string): string {
  switch (status.toUpperCase()) {
    case "COMPLETED":
      return "bg-status-paid-bg text-status-paid-text";
    case "IN_PROGRESS":
      return "bg-status-pending-bg text-status-pending-text";
    case "QUOTATION_SENT":
      return "bg-status-shipped-bg text-status-shipped-text";
    case "DRAFT":
    default:
      return "bg-status-refunded-bg text-status-refunded-text";
  }
}

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");
  const session = await requireSession(orgSlug);

  const [projects, t] = await Promise.all([
    listProjects(session),
    getTranslations("projects"),
  ]);

  return (
    <>
      {/* Page header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-[27px] font-extrabold text-text-heading">
            {t("pageTitle")}
            <span className="rounded-pill bg-primary-softer px-2.5 py-0.5 text-[12.5px] font-bold text-primary-dark">
              {projects.length}
            </span>
          </h1>
          <p className="mt-1 text-[13.5px] text-text-muted">{t("pageSubtitle")}</p>
        </div>
        <Link
          href={`${base}/projects/new`}
          className="rounded-sm bg-primary px-4 py-2.5 text-[13px] font-bold text-text-on-primary hover:bg-primary-dark"
        >
          + {t("createProject")}
        </Link>
      </div>

      {/* Toolbar (inert — filtering is a future-stage feature) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Left: date filter button */}
        <button
          type="button"
          disabled
          className="flex items-center gap-1.5 rounded-sm border border-border bg-bg-white px-3 py-2 text-[13px] font-semibold text-text-body opacity-60 cursor-not-allowed"
        >
          <svg
            className="h-3.5 w-3.5 text-text-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          All dates
          <svg
            className="h-3 w-3 text-text-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {/* Right: search + segmented */}
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="text"
            placeholder="Search projects..."
            disabled
            className="w-[230px] rounded-sm border border-border bg-bg-white px-3 py-2 text-[13px] text-text-placeholder placeholder:text-text-placeholder opacity-60 cursor-not-allowed focus:outline-none"
          />
          <div className="flex overflow-hidden rounded-sm border border-border bg-bg-white text-[13px] font-semibold">
            <button
              type="button"
              disabled
              className="border-r border-border px-3 py-2 text-text-muted opacity-60 cursor-not-allowed"
            >
              My Projects
            </button>
            <button
              type="button"
              disabled
              className="bg-primary-softer px-3 py-2 text-text-heading opacity-60 cursor-not-allowed"
            >
              All Projects
            </button>
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="rounded-md border border-border bg-bg-card shadow-card">
        <div className="overflow-x-auto px-4 py-2">
          {projects.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-muted">
              {t("noProjects")}
            </p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] font-extrabold uppercase tracking-wide text-text-muted">
                    <th className="w-7 py-2.5 pr-3">
                      <input
                        type="checkbox"
                        disabled
                        className="cursor-not-allowed opacity-60"
                        readOnly
                      />
                    </th>
                    <th className="py-2.5 pr-4">Project ID</th>
                    <th className="py-2.5 pr-4">{t("colName")}</th>
                    <th className="py-2.5 pr-4">{t("colExternalCompany")}</th>
                    <th className="py-2.5 pr-4">{t("colStatus")}</th>
                    <th className="py-2.5 pr-4">{t("colDate")}</th>
                    <th className="py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {projects.map((project) => (
                    <tr
                      key={project.id}
                      className="text-text-body hover:bg-primary-softer"
                    >
                      <td className="py-3 pr-3">
                        <input
                          type="checkbox"
                          disabled
                          className="cursor-not-allowed opacity-60"
                          readOnly
                        />
                      </td>
                      <td className="py-3 pr-4 font-bold text-text-heading">
                        <Link
                          href={`${base}/projects/${project.id}`}
                          className="hover:underline"
                        >
                          #{project.projectNumber}
                        </Link>
                      </td>
                      <td className="py-3 pr-4">
                        <Link
                          href={`${base}/projects/${project.id}`}
                          className="hover:underline"
                        >
                          {project.name}
                        </Link>
                      </td>
                      <td className="py-3 pr-4 text-text-muted">
                        {project.externalCompany?.name ?? (
                          <span className="text-text-placeholder">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-bold ${statusClasses(project.status)}`}
                        >
                          {project.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-text-muted">
                        {new Date(project.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3">
                        <Link
                          href={`${base}/projects/${project.id}`}
                          className="rounded-sm border border-border bg-bg-white px-3 py-1.5 text-[12.5px] font-semibold text-text-body hover:bg-primary-softer hover:text-text-heading"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Table footer */}
              <div className="flex items-center justify-between border-t border-border px-3 pb-1 pt-[14px]">
                <span className="text-[12.5px] text-text-muted">
                  {projects.length} project{projects.length === 1 ? "" : "s"} &middot; Page 1 of 1
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled
                    className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-[13px] font-bold text-text-on-primary"
                  >
                    1
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
