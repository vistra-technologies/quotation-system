import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { listPermissions } from "@/lib/data/admin";
import { requireSession, requirePermissionFor } from "@/lib/data/session";
import { orgHref } from "@/lib/orgHref";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Permission catalog page (Server Component).
 *
 * Lists ALL global Permission rows — no org scope, by design.
 * A permission created by any org's admin is visible here.
 *
 * ⚠ The inert-by-design caveat is displayed prominently above the table:
 * creating a Permission row grants no capability until a developer wires it.
 *
 * Gated on MANAGE_FEATURES. Wrong-role users are redirected to the dashboard.
 *
 * Stage 11 (Batch 9): restyled to Sage Ease tokens.
 */
export default async function PermissionsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");
  const session = await requireSession(orgSlug);
  await requirePermissionFor(session, PERMISSIONS.MANAGE_FEATURES, orgSlug);

  const [permissions, t] = await Promise.all([
    listPermissions(),
    getTranslations("permissions"),
  ]);

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
