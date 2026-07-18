import Link from "next/link";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { getAdminPermissions } from "@/lib/data/admin";
import allMessages from "@/messages/en.json";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Admin section layout (Server Component).
 *
 * Gates the entire /[orgSlug]/admin/* sub-tree on MANAGE_USERS or MANAGE_FEATURES.
 * A single DB query covers both the gate check and which nav links to render.
 *
 * Provides NextIntlClientProvider so Client Components under this layout
 * (e.g. LoadingOverlay, form components) can use useTranslations().
 * Only Stage 4 namespaces are forwarded — the full messages/en.json is never
 * sent to the client wholesale.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await getSession();

  if (!session) {
    redirect(`/${orgSlug}/login`);
  }

  // One query for both the access gate and nav visibility.
  const adminCodes = await getAdminPermissions(session);

  if (adminCodes.length === 0) {
    redirect(`/${orgSlug}/dashboard`);
  }

  const canManageUsers = adminCodes.includes(PERMISSIONS.MANAGE_USERS);
  const canManageFeatures = adminCodes.includes(PERMISSIONS.MANAGE_FEATURES);

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
      <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
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
        <main className="mx-auto w-full max-w-5xl px-6 py-8">{children}</main>
      </div>
    </NextIntlClientProvider>
  );
}
