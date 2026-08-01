import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { CreateExternalCompanyForm } from "./create-external-company-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create-external-company page (Server Component shell).
 *
 * Gates on MANAGE_USERS; delegates the interactive form to the
 * CreateExternalCompanyForm Client Component.
 *
 * Stage 12 Batch 6: switched from requireSession/requirePermissionFor to
 * internalFetch against /api/v1/orgs/[orgSlug]/me for MANAGE_USERS check.
 */
export default async function NewExternalCompanyPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");

  const meRes = await internalFetch(`/api/v1/orgs/${orgSlug}/me`);
  if (meRes.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (meRes.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  const me = (await meRes.json()) as { adminPermissions: string[] };
  if (!me.adminPermissions.includes("MANAGE_USERS")) {
    redirect(await orgHref(orgSlug, "/dashboard"));
  }

  const t = await getTranslations("externalCompanies");

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href={`${base}/admin/external-companies`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        {t("backToList")}
      </Link>

      <h1 className="mt-2 text-2xl font-bold text-text-heading">
        {t("createPageTitle")}
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        {t("createPageSubtitle")}
      </p>

      <div className="mt-6 rounded-md border border-border bg-bg-card p-6 shadow-card">
        <CreateExternalCompanyForm orgSlug={orgSlug} />
      </div>
    </div>
  );
}
