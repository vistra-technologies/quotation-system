import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * External Companies list page (Server Component).
 *
 * Lists all external companies within the session's org, ordered A→Z by name.
 * Gated on MANAGE_USERS — wrong-role requests redirect to the dashboard.
 *
 * Stage 12 Batch 6: switched from requireSession/requirePermissionFor/listExternalCompanies
 * DAL to internalFetch against /me and /external-companies.
 */
export default async function ExternalCompaniesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [meRes, companiesRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/me`),
    internalFetch(`/api/v1/orgs/${orgSlug}/external-companies`),
    getTranslations("externalCompanies"),
  ]);

  if (meRes.status === 401 || companiesRes.status === 401) {
    redirect(await orgHref(orgSlug, "/login"));
  }
  if (meRes.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  const me = (await meRes.json()) as { adminPermissions: string[] };
  if (!me.adminPermissions.includes("MANAGE_USERS")) {
    redirect(await orgHref(orgSlug, "/dashboard"));
  }

  const { companies } = (await companiesRes.json()) as {
    companies: Array<{ id: string; name: string; type: string }>;
  };

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
          href={`/${orgSlug}/admin/external-companies/new`}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {t("createCompany")}
        </Link>
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                  {t("colName")}
                </th>
                <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                  {t("colType")}
                </th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr
                  key={company.id}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                >
                  <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-50">
                    {company.name}
                  </td>
                  <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">
                    {company.type === "DISTRIBUTOR"
                      ? t("typeDistributor")
                      : t("typeArchitecturalFirm")}
                  </td>
                  <td className="px-5 py-3" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
