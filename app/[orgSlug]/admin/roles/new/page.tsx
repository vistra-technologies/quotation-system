import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { CreateRoleForm } from "./create-role-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create-role page (Server Component shell).
 *
 * Handles auth + RBAC gate server-side via the /me route, then delegates form
 * rendering to the CreateRoleForm Client Component (which needs to be a Client
 * Component so useFormStatus() can drive the loading overlay).
 *
 * Stage 12 Batch 6: switched from getSession()/requirePermission() DAL to
 * internalFetch against /api/v1/orgs/[orgSlug]/me.
 */
export default async function NewRolePage({
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
  if (!me.adminPermissions.includes("MANAGE_FEATURES")) {
    redirect(await orgHref(orgSlug, "/dashboard"));
  }

  const t = await getTranslations("roles");

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <Link
        href={`${base}/admin/roles`}
        className="mb-4 inline-block text-sm text-text-muted hover:text-text-heading"
      >
        {t("backToList")}
      </Link>

      <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-text-heading">
        {t("createPageTitle")}
      </h1>

      <div className="mt-6 max-w-lg rounded-md border border-border bg-bg-card px-5 py-4 shadow-card">
        <CreateRoleForm
          orgSlug={orgSlug}
          fieldNameLabel={t("fieldName")}
          fieldDescriptionLabel={t("fieldDescription")}
          submitLabel={t("submitCreate")}
        />
      </div>
    </div>
  );
}
