import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import allMessages from "@/messages/en.json";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Admin section layout (Server Component).
 *
 * Gates the entire /[orgSlug]/admin/* sub-tree on MANAGE_USERS or MANAGE_FEATURES.
 * A single /me call covers the gate check. Navigation for admin sections is handled
 * by the shared sidebar (Stage 10 app shell); the duplicate top-bar header nav was
 * removed in Stage 11 Batch 1 and must not be reintroduced here.
 *
 * Provides NextIntlClientProvider so Client Components under this layout
 * (e.g. LoadingOverlay, form components) can use useTranslations().
 * Only the required namespaces are forwarded — the full messages/en.json is never
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
      <div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>
    </NextIntlClientProvider>
  );
}
