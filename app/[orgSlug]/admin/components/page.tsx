import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { listComponentTypes, isCoreComponentType } from "@/lib/data/components";
import { requireSession, requirePermissionFor } from "@/lib/data/session";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * ComponentType list page (Server Component).
 *
 * Lists all ComponentTypes for the session's organization.
 * Gated on MANAGE_FEATURES — wrong-role requests redirect to the dashboard.
 */
export default async function ComponentTypesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await requireSession(orgSlug);
  await requirePermissionFor(session, PERMISSIONS.MANAGE_FEATURES, orgSlug);

  const [types, t] = await Promise.all([
    listComponentTypes(session),
    getTranslations("components"),
  ]);

  return (
    <div>
      {/* Inert caveat — always visible; all schemas are inert until Stage 6 wiring */}
      <aside className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        {t("inertCaveat")}
      </aside>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("pageTitle")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t("pageSubtitle")}
          </p>
        </div>
        <Link
          href={`/${orgSlug}/admin/components/new`}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {t("createType")}
        </Link>
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                  {t("colCode")}
                </th>
                <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                  {t("colName")}
                </th>
                <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                  {t("colFields")}
                </th>
                <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                  {t("colStatus")}
                </th>
                <th className="px-5 py-3 text-right font-medium text-zinc-500 dark:text-zinc-400">
                  {t("colActions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {types.map((ct) => {
                const isCore = isCoreComponentType(ct.code);
                return (
                  <tr
                    key={ct.id}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                  >
                    <td className="px-5 py-3 font-mono text-xs font-medium text-zinc-900 dark:text-zinc-50">
                      {ct.code}
                    </td>
                    <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-50">
                      {ct.name}
                    </td>
                    <td className="px-5 py-3 text-zinc-500 dark:text-zinc-400">
                      {ct.fieldsSchema.length === 0
                        ? "—"
                        : `${ct.fieldsSchema.length} field${ct.fieldsSchema.length !== 1 ? "s" : ""}`}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={
                            ct.active
                              ? "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300"
                              : "inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                          }
                        >
                          {ct.active ? t("statusActive") : t("statusInactive")}
                        </span>
                        <span
                          className={
                            isCore
                              ? "inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                              : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                          }
                        >
                          {isCore ? t("statusCore") : t("inertBadge")}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/${orgSlug}/admin/components/${ct.id}`}
                        className="text-sm font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
                      >
                        {t("editPageTitle")}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
