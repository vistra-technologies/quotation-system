import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listExternalCompanies, getExternalCompanyById } from "@/lib/data/external-companies";
import { requireSession } from "@/lib/data/session";
import { orgHref } from "@/lib/orgHref";
import { CreateInquiryForm } from "./create-inquiry-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create-inquiry page (Server Component shell).
 *
 * Any authenticated user in the org may create an inquiry — no special
 * RBAC permission is required beyond a valid session for this org.
 *
 * If the session user is tied to a fixed ExternalCompany (distributor /
 * architectural-firm user), the Client field is locked to that company —
 * only that company's name is fetched for display.  Otherwise the full
 * org list is fetched for the free-choice dropdown (current behavior).
 *
 * Stage 11 (Batch 5): restyled to Sage Ease tokens — back link, page heading,
 * wider layout (removes max-w-lg), backHref passed to form for Cancel button.
 * No logic changes.
 */
export default async function NewInquiryPage({
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
    getTranslations("inquiries"),
  ]);

  const backHref = `${base}/inquiries`;

  return (
    <div>
      {/* Back link */}
      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        {t("backToList")}
      </Link>

      {/* Page heading */}
      <div className="mb-6">
        <h1 className="text-[27px] font-extrabold text-text-heading">
          {t("createPageTitle")}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {t("createPageSubtitle")}
        </p>
      </div>

      <CreateInquiryForm
        orgSlug={orgSlug}
        lockedCompany={lockedCompany}
        externalCompanies={externalCompanies}
        backHref={backHref}
      />
    </div>
  );
}
