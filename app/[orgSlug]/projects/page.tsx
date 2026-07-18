import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listProjects } from "@/lib/data/projects";
import { requireSession } from "@/lib/data/session";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Projects list page (Server Component).
 *
 * Lists all projects within the session's org, newest-first.
 * Auth-protected (any authenticated user); no special RBAC permission required.
 */
export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await requireSession(orgSlug);

  const [projects, t] = await Promise.all([
    listProjects(session),
    getTranslations("projects"),
  ]);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("pageTitle")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t("pageSubtitle")}
          </p>
        </div>
        <Link
          href={`/${orgSlug}/projects/new`}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {t("createProject")}
        </Link>
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {projects.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t("noProjects")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                  <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                    {t("colNumber")}
                  </th>
                  <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                    {t("colName")}
                  </th>
                  <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                    {t("colStatus")}
                  </th>
                  <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                    {t("colExternalCompany")}
                  </th>
                  <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                    {t("colDate")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr
                    key={project.id}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                  >
                    <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-50">
                      <Link
                        href={`/${orgSlug}/projects/${project.id}`}
                        className="hover:underline"
                      >
                        #{project.projectNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-zinc-900 dark:text-zinc-50">
                      <Link
                        href={`/${orgSlug}/projects/${project.id}`}
                        className="hover:underline"
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {project.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">
                      {project.externalCompany?.name ?? (
                        <span className="text-zinc-400 dark:text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-zinc-500 dark:text-zinc-400">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
