import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { requireSession, requirePermissionFor } from "@/lib/data/session";
import { CreateExternalCompanyForm } from "./create-external-company-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create-external-company page (Server Component shell).
 *
 * Gates on MANAGE_USERS; delegates the interactive form to the
 * CreateExternalCompanyForm Client Component.
 */
export default async function NewExternalCompanyPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await requireSession(orgSlug);
  await requirePermissionFor(session, PERMISSIONS.MANAGE_USERS, orgSlug);

  const t = await getTranslations("externalCompanies");

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href={`/${orgSlug}/admin/external-companies`}
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

      <CreateExternalCompanyForm orgSlug={orgSlug} />
    </div>
  );
}
