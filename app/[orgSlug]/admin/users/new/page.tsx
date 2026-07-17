import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { listRolesForDropdown, listExternalCompanies } from "@/lib/data/admin";
import { requireSession, requirePermissionFor } from "@/lib/data/session";
import { CreateUserForm } from "./create-user-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create-user page (Server Component shell).
 *
 * Fetches the org's roles and external companies for the form dropdowns,
 * then delegates the interactive form to the CreateUserForm Client Component.
 */
export default async function NewUserPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await requireSession(orgSlug);
  await requirePermissionFor(session, PERMISSIONS.MANAGE_USERS, orgSlug);

  const [roles, externalCompanies, t] = await Promise.all([
    listRolesForDropdown(session),
    listExternalCompanies(session),
    getTranslations("users"),
  ]);

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href={`/${orgSlug}/admin/users`}
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

      <CreateUserForm
        orgSlug={orgSlug}
        roles={roles}
        externalCompanies={externalCompanies}
      />
    </div>
  );
}
