import Link from "next/link";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import allMessages from "@/messages/en.json";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Admin section layout (Server Component).
 *
 * Gates the entire /[orgSlug]/admin/* sub-tree on MANAGE_USERS or MANAGE_FEATURES.
 * A single /me call covers both the gate check and which nav links to render.
 *
 * Provides NextIntlClientProvider so Client Components under this layout
 * (e.g. LoadingOverlay, form components) can use useTranslations().
 * Only Stage 4 namespaces are forwarded — the full messages/en.json is never
 * sent to the client wholesale.
 *
 * Stage 12 Batch 6: switched from getSession()/getAdminPermissions() DAL to
 * internalFetch against /api/v1/orgs/[orgSlug]/me.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const meRes = await internalFetch(`/api/v1/orgs/${orgSlug}/me`);

  if (meRes.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (meRes.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  const me = (await meRes.json()) as { adminPermissions: string[] };

  if (me.adminPermissions.length === 0) {
    redirect(await orgHref(orgSlug, "/dashboard"));
  }

  const canManageUsers = me.adminPermissions.includes("MANAGE_USERS");
  const canManageFeatures = me.adminPermissions.includes("MANAGE_FEATURES");

  const t = await getTranslations("admin");

  // Precompute org-aware hrefs — orgHref() returns the bare subpath in subdomain
  // mode (e.g. "/admin/users" on vistra.easeetool.com) and the org-prefixed path
  // in path-based mode (e.g. "/vistra/admin/users" on localhost).
  const hrefDashboard = await orgHref(orgSlug, "/dashboard");
  const hrefUsers = await orgHref(orgSlug, "/admin/users");
  const hrefExtCompanies = await orgHref(orgSlug, "/admin/external-companies");
  const hrefRoles = await orgHref(orgSlug, "/admin/roles");
  const hrefPermissions = await orgHref(orgSlug, "/admin/permissions");
  const hrefComponents = await orgHref(orgSlug, "/admin/components");

  // Forward only the namespaces Client Components in this sub-tree need.
  const clientMessages = {
    common: allMessages.common,
    admin: allMessages.admin,
    users: allMessages.users,
    roles: allMessages.roles,
    permissions: allMessages.permissions,
    components: allMessages.components,
    externalCompanies: allMessages.externalCompanies,
  };

  return (
    <NextIntlClientProvider messages={clientMessages}>
      <div>
        {/* Admin secondary nav — Sage Ease tokens, matching app-shell style */}
        <header className="border-b border-border bg-bg-card">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
            <Link
              href={hrefDashboard}
              className="shrink-0 text-sm font-medium text-text-muted hover:text-text-heading"
            >
              {t("backToDashboard")}
            </Link>
            <nav className="flex gap-1">
              {canManageUsers && (
                <>
                  <Link
                    href={hrefUsers}
                    className="rounded-sm px-3 py-[6px] text-sm font-semibold text-text-body hover:bg-primary-softer hover:text-text-heading"
                  >
                    {t("navUsers")}
                  </Link>
                  <Link
                    href={hrefExtCompanies}
                    className="rounded-sm px-3 py-[6px] text-sm font-semibold text-text-body hover:bg-primary-softer hover:text-text-heading"
                  >
                    {t("navExternalCompanies")}
                  </Link>
                </>
              )}
              {canManageFeatures && (
                <>
                  <Link
                    href={hrefRoles}
                    className="rounded-sm px-3 py-[6px] text-sm font-semibold text-text-body hover:bg-primary-softer hover:text-text-heading"
                  >
                    {t("navRoles")}
                  </Link>
                  <Link
                    href={hrefPermissions}
                    className="rounded-sm px-3 py-[6px] text-sm font-semibold text-text-body hover:bg-primary-softer hover:text-text-heading"
                  >
                    {t("navPermissions")}
                  </Link>
                  <Link
                    href={hrefComponents}
                    className="rounded-sm px-3 py-[6px] text-sm font-semibold text-text-body hover:bg-primary-softer hover:text-text-heading"
                  >
                    {t("navComponents")}
                  </Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>
      </div>
    </NextIntlClientProvider>
  );
}
