import Link from "next/link";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { EditExternalCompanyForm } from "./edit-external-company-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── API response types ──────────────────────────────────────────────────────

interface CompanyDetail {
  id: string;
  name: string;
  type: string;
  country: string;
  defaultCurrency: string;
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Edit-external-company page (Server Component shell).
 *
 * Gates on MANAGE_USERS; fetches the existing company data to pre-fill
 * the form; delegates the interactive form to EditExternalCompanyForm.
 *
 * Stage 13 Batch 2.
 */
export default async function EditExternalCompanyPage({
  params,
}: {
  params: Promise<{ orgSlug: string; companyId: string }>;
}) {
  const { orgSlug, companyId } = await params;
  const base = await orgHref(orgSlug, "");

  const [meRes, companyRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/me`),
    internalFetch(`/api/v1/orgs/${orgSlug}/external-companies/${companyId}`),
    getTranslations("externalCompanies"),
  ]);

  if (meRes.status === 401 || companyRes.status === 401) {
    redirect(await orgHref(orgSlug, "/login"));
  }
  if (meRes.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  const me = (await meRes.json()) as { adminPermissions: string[] };
  if (!me.adminPermissions.includes("MANAGE_USERS")) {
    redirect(await orgHref(orgSlug, "/dashboard"));
  }

  if (companyRes.status === 404) {
    notFound();
  }

  if (!companyRes.ok) {
    redirect(await orgHref(orgSlug, "/admin/external-companies"));
  }

  const { company } = (await companyRes.json()) as { company: CompanyDetail };

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href={`${base}/admin/external-companies`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        {t("backToList")}
      </Link>

      <h1 className="mt-2 text-2xl font-bold text-text-heading">
        {t("editPageTitle")}
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        {t("editPageSubtitle")}
      </p>

      <div className="mt-6 rounded-md border border-border bg-bg-card p-6 shadow-card">
        <EditExternalCompanyForm
          orgSlug={orgSlug}
          companyId={companyId}
          initialName={company.name}
          initialType={company.type}
          initialCountry={company.country}
          initialDefaultCurrency={company.defaultCurrency}
        />
      </div>
    </div>
  );
}
