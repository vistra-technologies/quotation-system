import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { listExternalCompanies } from "@/lib/data/external-companies";
import { requireSession, requirePermissionFor } from "@/lib/data/session";
import { orgHref } from "@/lib/orgHref";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * External Companies list page (Server Component).
 *
 * Lists all external companies within the session's org, ordered A→Z by name.
 * Gated on MANAGE_USERS — wrong-role requests redirect to the dashboard.
 *
 * Stage 11 Batch 8: restyled to Sage Ease tokens. No logic changes.
 */
export default async function ExternalCompaniesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");
  const session = await requireSession(orgSlug);
  await requirePermissionFor(session, PERMISSIONS.MANAGE_USERS, orgSlug);

  const [companies, t] = await Promise.all([
    listExternalCompanies(session),
    getTranslations("externalCompanies"),
  ]);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-heading">
            {t("pageTitle")}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {t("pageSubtitle")}
          </p>
        </div>
        <Link
          href={`${base}/admin/external-companies/new`}
          className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
        >
          {t("createCompany")}
        </Link>
      </div>

      <div className="mt-6 rounded-md border border-border bg-bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colName")}
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colType")}
                </th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr
                  key={company.id}
                  className="border-b border-border last:border-0 hover:bg-primary-softer/40"
                >
                  <td className="px-5 py-4 font-bold text-text-heading">
                    {company.name}
                  </td>
                  <td className="px-5 py-4 text-text-body">
                    {company.type === "DISTRIBUTOR"
                      ? t("typeDistributor")
                      : t("typeArchitecturalFirm")}
                  </td>
                  <td className="px-5 py-4" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
