import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getSession } from "@/lib/session";
import { getAdminPermissions } from "@/lib/data/admin";
import { orgHref } from "@/lib/orgHref";
import allMessages from "@/messages/en.json";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Admin section layout (Server Component).
 *
 * Gates the entire /[orgSlug]/admin/* sub-tree on MANAGE_USERS or MANAGE_FEATURES.
 *
 * Provides NextIntlClientProvider so Client Components under this layout
 * (e.g. LoadingOverlay, form components) can use useTranslations().
 * Only the required namespaces are forwarded — the full messages/en.json is never
 * sent to the client wholesale.
 *
 * Navigation for admin sections is handled by the shared sidebar (Stage 10 app shell);
 * the duplicate top-bar header nav was removed in Stage 11 Batch 1.
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
    redirect(await orgHref(orgSlug, "/login"));
  }

  // Query admin permission codes for the access gate.
  const adminCodes = await getAdminPermissions(session);

  if (adminCodes.length === 0) {
    redirect(await orgHref(orgSlug, "/dashboard"));
  }

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
      {children}
    </NextIntlClientProvider>
  );
}
