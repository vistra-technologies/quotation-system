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
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
            <Link
              href={`/${orgSlug}/dashboard`}
              className="shrink-0 text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              {t("backToDashboard")}
            </Link>
            <nav className="flex gap-4">
              {canManageUsers && (
                <>
                  <Link
                    href={`/${orgSlug}/admin/users`}
                    className="text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
                  >
                    {t("navUsers")}
                  </Link>
                  <Link
                    href={`/${orgSlug}/admin/external-companies`}
                    className="text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
                  >
                    {t("navExternalCompanies")}
                  </Link>
                </>
              )}
              {canManageFeatures && (
                <>
                  <Link
                    href={`/${orgSlug}/admin/roles`}
                    className="text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
                  >
                    {t("navRoles")}
                  </Link>
                  <Link
                    href={`/${orgSlug}/admin/permissions`}
                    className="text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
                  >
                    {t("navPermissions")}
                  </Link>
                  <Link
                    href={`/${orgSlug}/admin/components`}
                    className="text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
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
