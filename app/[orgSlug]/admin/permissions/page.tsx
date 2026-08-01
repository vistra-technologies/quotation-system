import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Permission catalog page (Server Component).
 *
 * Lists ALL global Permission rows — no org scope, by design.
 * A permission created by any org's admin is visible here.
 *
 * Gated on MANAGE_FEATURES (enforced by GET /api/v1/permissions).
 *
 * Stage 12 Batch 6: switched from requireSession/requirePermissionFor/listPermissions DAL
 * to internalFetch against GET /api/v1/permissions (global endpoint).
 */
export default async function PermissionsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");

  const [permsRes, t] = await Promise.all([
    internalFetch(`/api/v1/permissions`),
    getTranslations("permissions"),
  ]);

  if (permsRes.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (permsRes.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));
  if (!permsRes.ok) notFound();

  const { permissions } = (await permsRes.json()) as {
    permissions: Array<{ id: string; code: string; description: string }>;
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-text-heading">
            {t("pageTitle")}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {t("pageSubtitle")}
          </p>
        </div>
        <Link
          href={`${base}/admin/permissions/new`}
          className="inline-flex items-center rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
        >
          {t("createPermission")}
        </Link>
      </div>

      {/* Inert-by-design caveat — prominent amber alert, not fine print */}
      <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 px-5 py-4">
        <p className="text-sm font-medium text-amber-800">
          {t("inertCaveat")}
        </p>
      </div>

      <div className="mt-4 rounded-md border border-border bg-bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colCode")}
                </th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colDescription")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {permissions.map((perm) => (
                <tr
                  key={perm.id}
                  className="hover:bg-primary-softer/40"
                >
                  <td className="px-5 py-4 font-mono text-xs font-semibold text-text-body">
                    {perm.code}
                  </td>
                  <td className="px-5 py-4 text-text-body">
                    {perm.description}
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
