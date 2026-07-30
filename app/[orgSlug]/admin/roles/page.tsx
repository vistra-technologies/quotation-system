import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { listRoles } from "@/lib/data/admin";
import { requireSession, requirePermissionFor } from "@/lib/data/session";
import { orgHref } from "@/lib/orgHref";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Roles list page (Server Component).
 *
 * Lists all roles for the session's organization.
 * Gated on MANAGE_FEATURES — wrong-role requests redirect to the dashboard.
 *
 * Stage 11 (Batch 9): restyled to Sage Ease tokens.
 */
export default async function RolesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");
  const session = await requireSession(orgSlug);
  await requirePermissionFor(session, PERMISSIONS.MANAGE_FEATURES, orgSlug);

  const [roles, t] = await Promise.all([
    listRoles(session),
    getTranslations("roles"),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-text-heading">
            {t("pageTitle")}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {t("pageSubtitle")}
          </p>
        </div>
        <Link
          href={`${base}/admin/roles/new`}
          className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
        >
          {t("createRole")}
        </Link>
      </div>

      <div className="mt-6 rounded-md border border-border bg-bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colName")}
                </th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colDescription")}
                </th>
                <th className="px-5 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colActions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {roles.map((role) => (
                <tr
                  key={role.id}
                  className="hover:bg-primary-softer/40"
                >
                  <td className="px-5 py-4 font-semibold text-text-heading">
                    {role.name}
                  </td>
                  <td className="px-5 py-4 text-text-muted">
                    {role.description ?? "—"}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`${base}/admin/roles/${role.id}`}
                      className="text-sm font-semibold text-primary hover:text-primary-dark"
                    >
                      {t("detailPageTitle")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
