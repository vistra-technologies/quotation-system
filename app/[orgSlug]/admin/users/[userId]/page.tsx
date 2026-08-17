import Link from "next/link";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { UserDetailForms } from "./user-detail-forms";
import { UserEditForm } from "./user-edit-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── API response types ──────────────────────────────────────────────────────

interface UserDetail {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  mobile: string | null;
  profileEmail: string | null;
  active: boolean;
  roleId: string;
  role: { name: string };
  externalCompanyId: string | null;
}

interface RoleOption {
  id: string;
  name: string;
  /** Stage 15 Batch G (U3): true for Admin and Company Member. */
  isInternalRole: boolean;
}

interface ExternalCompanyOption {
  id: string;
  name: string;
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * User detail page (Server Component shell).
 *
 * Stage 15 Batch G (U4, U5):
 * - U4: added profile editing capability — firstName, lastName, mobile,
 *       profileEmail, externalCompanyId are now editable via UserEditForm
 *       (→ PUT /api/v1/orgs/[orgSlug]/users/[userId]/profile).
 * - U5: redesigned layout — one main edit card (UserEditForm) containing all
 *       editable fields + role change; a separate Danger Zone card (UserDetailForms)
 *       for activate/deactivate and set password.
 *
 * Fetches: user detail, roles (with isInternalRole), external companies.
 * RBAC (MANAGE_USERS) is enforced by the route handlers.
 *
 * Tenancy guard: getUserById in the route handler filters by both id AND
 * organizationId = session's org, so a spoofed id for a different org returns 404.
 */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; userId: string }>;
}) {
  const { orgSlug, userId } = await params;
  const base = await orgHref(orgSlug, "");

  const [userRes, rolesRes, companiesRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/users/${userId}`),
    internalFetch(`/api/v1/orgs/${orgSlug}/roles`),
    internalFetch(`/api/v1/orgs/${orgSlug}/external-companies`),
    getTranslations("users"),
  ]);

  if (userRes.status === 401 || userRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (userRes.status === 404) {
    notFound();
  }

  if (!userRes.ok) {
    notFound();
  }

  const { user, isSelf } = (await userRes.json()) as {
    user: UserDetail;
    isSelf: boolean;
  };

  const roles: RoleOption[] = rolesRes.ok
    ? ((await rolesRes.json()) as { roles: RoleOption[] }).roles
    : [];

  const externalCompanies: ExternalCompanyOption[] = companiesRes.ok
    ? ((await companiesRes.json()) as { companies: ExternalCompanyOption[] }).companies
    : [];

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href={`${base}/admin/users`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        {t("backToList")}
      </Link>

      {/* Page title + username (read-only identity anchor) */}
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold text-text-heading">
          {t("detailPageTitle")}
        </h1>
        <span className="text-sm text-text-muted">
          @{user.username}
          {user.active ? null : (
            <span className="ml-2 inline-flex items-center rounded-pill bg-border px-2 py-0.5 text-xs font-bold text-text-muted">
              {t("statusInactive")}
            </span>
          )}
        </span>
      </div>

      {/* Main edit card: profile fields + role change */}
      <div className="mt-4">
        <UserEditForm
          orgSlug={orgSlug}
          userId={user.id}
          currentFirstName={user.firstName}
          currentLastName={user.lastName}
          currentMobile={user.mobile}
          currentProfileEmail={user.profileEmail}
          currentExternalCompanyId={user.externalCompanyId}
          currentRoleId={user.roleId}
          roles={roles}
          externalCompanies={externalCompanies}
        />
      </div>

      {/* Danger Zone: activate/deactivate + set password */}
      <div className="mt-6">
        <UserDetailForms
          orgSlug={orgSlug}
          userId={user.id}
          isActive={user.active}
          isSelf={isSelf}
        />
      </div>
    </div>
  );
}
