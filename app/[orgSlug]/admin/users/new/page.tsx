import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { CreateUserForm } from "./create-user-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── API response types ──────────────────────────────────────────────────────

interface RoleOption {
  id: string;
  name: string;
}

interface ExternalCompanyOption {
  id: string;
  name: string;
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Create-user page (Server Component shell).
 *
 * Fetches the org's roles and external companies for the form dropdowns,
 * then delegates the interactive form to the CreateUserForm Client Component.
 *
 * Stage 12: switched from direct requireSession + DAL calls to internalFetch
 * against GET /api/v1/orgs/[orgSlug]/roles (MANAGE_USERS-gated, new in Batch 5)
 * and GET /api/v1/orgs/[orgSlug]/external-companies (auth-only, from Batch 2).
 * RBAC (MANAGE_USERS) is enforced by the roles route handler — 401/403 redirects
 * to login.
 */
export default async function NewUserPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [rolesRes, companiesRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/roles`),
    internalFetch(`/api/v1/orgs/${orgSlug}/external-companies`),
    getTranslations("users"),
  ]);

  if (rolesRes.status === 401 || rolesRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  const roles: RoleOption[] = rolesRes.ok
    ? ((await rolesRes.json()) as { roles: RoleOption[] }).roles
    : [];

  const externalCompanies: ExternalCompanyOption[] = companiesRes.ok
    ? ((await companiesRes.json()) as { companies: ExternalCompanyOption[] })
        .companies
    : [];

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
