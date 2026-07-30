import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { listRolesForDropdown, listExternalCompanies } from "@/lib/data/admin";
import { requireSession, requirePermissionFor } from "@/lib/data/session";
import { orgHref } from "@/lib/orgHref";
import { CreateUserForm } from "./create-user-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create-user page (Server Component shell).
 *
 * Fetches the org's roles and external companies for the form dropdowns,
 * then delegates the interactive form to the CreateUserForm Client Component.
 *
 * Stage 11 Batch 8: restyled to Sage Ease tokens. No logic changes.
 */
export default async function NewUserPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");
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
        href={`${base}/admin/users`}
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
        <CreateUserForm
          orgSlug={orgSlug}
          roles={roles}
          externalCompanies={externalCompanies}
        />
      </div>
    </div>
  );
}
