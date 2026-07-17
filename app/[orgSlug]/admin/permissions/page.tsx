import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { listPermissions } from "@/lib/data/admin";
import { requireSession, requirePermissionFor } from "@/lib/data/session";

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
 */
export default async function PermissionsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await requireSession(orgSlug);
  await requirePermissionFor(session, PERMISSIONS.MANAGE_FEATURES, orgSlug);

  const [permissions, t] = await Promise.all([
    listPermissions(),
    getTranslations("permissions"),
  ]);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("pageTitle")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t("pageSubtitle")}
          </p>
        </div>
        <Link
          href={`/${orgSlug}/admin/permissions/new`}
          className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 shadow-sm hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {t("createPermission")}
        </Link>
      </div>

      {/* Inert-by-design caveat — prominent amber alert, not fine print */}
      <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 dark:border-amber-700 dark:bg-amber-950">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
          {t("inertCaveat")}
        </p>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                  {t("colCode")}
                </th>
                <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                  {t("colDescription")}
                </th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((perm) => (
                <tr
                  key={perm.id}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                >
                  <td className="px-5 py-3 font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    {perm.code}
                  </td>
                  <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">
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
