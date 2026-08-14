import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { DeleteCompanyButton } from "./delete-company-button";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── API response types ──────────────────────────────────────────────────────

interface CompanyRow {
  id: string;
  name: string;
  type: string;
  country: string;
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * External Companies list page (Server Component).
 *
 * Lists all external companies within the session's org, ordered A→Z by name.
 * Gated on MANAGE_USERS — wrong-role requests redirect to the dashboard.
 *
 * Stage 12 Batch 6: switched from requireSession/requirePermissionFor/listExternalCompanies
 * DAL to internalFetch against /me and /external-companies.
 * Stage 13 Batch 2: added Country column; added Edit link and Delete button per row.
 */
export default async function ExternalCompaniesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");

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
    companies: CompanyRow[];
  };

  function countryLabel(country: string) {
    if (country === "INDIA") return t("countryIndia");
    if (country === "UAE") return t("countryUAE");
    return country;
  }

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
                <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colCountry")}
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
                  <td className="px-5 py-4 text-text-body">
                    {countryLabel(company.country)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`${base}/admin/external-companies/${company.id}`}
                        aria-label={t("editAction")}
                        title={t("editAction")}
                        className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-primary-dark hover:bg-primary-softer hover:text-primary"
                      >
                        {/* Pencil icon 16×16 */}
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          aria-hidden="true"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L2.543 12.023l-.625 2.185 2.185-.625L13.64 4.047a.25.25 0 0 0 0-.354l-1.213-1.206Z"
                            fill="currentColor"
                          />
                        </svg>
                      </Link>
                      <DeleteCompanyButton
                        orgSlug={orgSlug}
                        companyId={company.id}
                        companyName={company.name}
                        confirmMessage={t("deleteConfirm", { name: company.name })}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
