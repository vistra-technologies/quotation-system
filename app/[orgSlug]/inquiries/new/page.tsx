import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listExternalCompanies } from "@/lib/data/external-companies";
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
 * Fetches the org's external companies for the optional select dropdown,
 * then delegates the interactive form to CreateInquiryForm (Client Component).
 *
 * Note: uses lib/data/external-companies (canonical Stage-6 dedicated file),
 * not lib/data/admin — the admin module has a pre-existing duplicate that the
 * projects/new page uses, but new pages use the canonical file.
 */
export default async function NewInquiryPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await requireSession(orgSlug);

  const [externalCompanies, t] = await Promise.all([
    listExternalCompanies(session),
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

      <CreateInquiryForm orgSlug={orgSlug} externalCompanies={externalCompanies} />
    </div>
  );
}
