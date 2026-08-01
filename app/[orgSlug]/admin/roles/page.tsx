import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Roles list page (Server Component).
 *
 * Lists all roles for the session's organization.
 * Gated on MANAGE_FEATURES — wrong-role requests redirect to the dashboard.
 *
 * Stage 12 Batch 6: switched from requireSession/requirePermissionFor/listRoles DAL
 * to internalFetch against GET /api/v1/orgs/[orgSlug]/me (for MANAGE_FEATURES gate)
 * and GET /api/v1/orgs/[orgSlug]/roles (for role data).
 * Both are called in parallel; MANAGE_FEATURES check from /me gates whether to render.
 */
export default async function RolesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");

  const [meRes, rolesRes] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/me`),
    internalFetch(`/api/v1/orgs/${orgSlug}/roles`),
  ]);

  if (meRes.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (meRes.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  const me = (await meRes.json()) as { adminPermissions: string[] };
  if (!me.adminPermissions.includes("MANAGE_FEATURES")) {
    redirect(await orgHref(orgSlug, "/dashboard"));
  }

  if (!rolesRes.ok) notFound();
  const { roles } = (await rolesRes.json()) as {
    roles: Array<{ id: string; name: string; description: string | null }>;
  };

  const t = await getTranslations("roles");

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
