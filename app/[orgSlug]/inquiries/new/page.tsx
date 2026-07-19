import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listExternalCompanies, getExternalCompanyById } from "@/lib/data/external-companies";
import { requireSession } from "@/lib/data/session";
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
 */
export default async function NewInquiryPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
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

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href={`/${orgSlug}/inquiries`}
        className="mb-4 inline-block text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        {t("backToList")}
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t("createPageTitle")}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {t("createPageSubtitle")}
      </p>

      <CreateInquiryForm
        orgSlug={orgSlug}
        lockedCompany={lockedCompany}
        externalCompanies={externalCompanies}
      />
    </div>
  );
}
