import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listExternalCompanies } from "@/lib/data/admin";
import { getExternalCompanyById } from "@/lib/data/external-companies";
import { requireSession } from "@/lib/data/session";
import { orgHref } from "@/lib/orgHref";
import { CreateProjectForm } from "./create-project-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create-project page (Server Component shell).
 *
 * Any authenticated user in the org may create a project — no special
 * RBAC permission is required beyond a valid session for this org.
 *
 * If the session user is tied to a fixed ExternalCompany (distributor /
 * architectural-firm user), the Client field is locked to that company —
 * only that company's name is fetched for display.  Otherwise the full
 * org list is fetched for the free-choice dropdown (current behavior).
 *
 * Stage 11 (Batch 6): outer chrome restyled to Sage Ease tokens — back
 * link, page heading, card wrapper. No data/prop changes.
 */
export default async function NewProjectPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");
  const session = await requireSession(orgSlug);

  const [lockedCompany, externalCompanies, t] = await Promise.all([
    session.externalCompanyId
      ? getExternalCompanyById(session, session.externalCompanyId)
      : Promise.resolve(null),
    session.externalCompanyId
      ? Promise.resolve([] as { id: string; name: string }[])
      : listExternalCompanies(session),
    getTranslations("projects"),
  ]);

  return (
    <div className="mx-auto max-w-lg">
      {/* Back link */}
      <Link
        href={`${base}/projects`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        {t("backToList")}
      </Link>

      {/* Page heading */}
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-text-heading">
          {t("createPageTitle")}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {t("createPageSubtitle")}
        </p>
      </div>

      {/* Form card */}
      <div className="rounded-md border border-border bg-bg-card p-6 shadow-card">
        <CreateProjectForm
          orgSlug={orgSlug}
          lockedCompany={lockedCompany}
          externalCompanies={externalCompanies}
        />
      </div>
    </div>
  );
}
