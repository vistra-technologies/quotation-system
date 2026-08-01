import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * ComponentType list page (Server Component).
 *
 * Lists all ComponentTypes for the session's organization.
 * Gated on MANAGE_FEATURES.
 *
 * Auth strategy:
 *   - GET /component-types is auth-only (not MANAGE_FEATURES-gated) because the
 *     configurator uses it too. So we use /me to check MANAGE_FEATURES first.
 *   - Both calls are parallel.
 *
 * Stage 12 Batch 6: switched from requireSession/requirePermissionFor/listComponentTypes
 * DAL to internalFetch against /me and /component-types.
 */
export default async function ComponentTypesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");

  const [meRes, typesRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/me`),
    internalFetch(`/api/v1/orgs/${orgSlug}/component-types`),
    getTranslations("components"),
  ]);

  if (meRes.status === 401 || typesRes.status === 401) {
    redirect(await orgHref(orgSlug, "/login"));
  }
  if (meRes.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  const me = (await meRes.json()) as { adminPermissions: string[] };
  if (!me.adminPermissions.includes("MANAGE_FEATURES")) {
    redirect(await orgHref(orgSlug, "/dashboard"));
  }

  if (!typesRes.ok) notFound();
  const { componentTypes: types } = (await typesRes.json()) as {
    componentTypes: Array<{
      id: string;
      code: string;
      name: string;
      active: boolean;
      categoryId: string;
      category: { name: string };
      fieldsSchema: unknown[];
    }>;
  };

  return (
    <div>
      {/* Title row */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h1 className="text-[27px] font-extrabold text-text-heading leading-tight">
            {t("pageTitle")}
          </h1>
          <p className="mt-1 text-[13.5px] text-text-muted">
            {t("pageSubtitle")}
          </p>
        </div>
        <Link
          href={`${base}/admin/components/new`}
          className="inline-flex items-center rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark shrink-0"
        >
          {t("createType")}
        </Link>
      </div>

      {/* Inert schema-only notice */}
      <aside className="mt-5 rounded-sm border border-status-pending-bg bg-status-pending-bg px-4 py-2.5 text-sm text-status-pending-text">
        {t("inertCaveat")}
      </aside>

      {/* Types card */}
      <div className="mt-5 rounded-md border border-border bg-bg-card shadow-card">
        {/* Card header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-extrabold text-text-heading">Registered Types</h2>
            <p className="mt-0.5 text-xs font-medium text-text-muted">
              Every component kind an admin can add on the Design step, and the fields captured for each.
            </p>
          </div>
          <span className="shrink-0 rounded-pill bg-primary-softer px-3 py-1.5 text-xs font-bold text-primary-dark whitespace-nowrap">
            {types.length} {types.length === 1 ? "type" : "types"}
          </span>
        </div>

        {types.length === 0 ? (
          /* Empty state */
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[10px] bg-primary-softer text-primary">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <circle cx="6.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-text-heading">No component types found</p>
            <p className="mt-1 text-xs text-text-muted">Create your first component type to get started.</p>
          </div>
        ) : (
          <div className="px-4 py-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-3 py-3 text-xs font-bold uppercase tracking-wide text-text-muted">
                    {t("colCode")}
                  </th>
                  <th className="px-3 py-3 text-xs font-bold uppercase tracking-wide text-text-muted">
                    {t("colName")}
                  </th>
                  <th className="px-3 py-3 text-xs font-bold uppercase tracking-wide text-text-muted">
                    {t("colCategory")}
                  </th>
                  <th className="px-3 py-3 text-xs font-bold uppercase tracking-wide text-text-muted">
                    {t("colFields")}
                  </th>
                  <th className="px-3 py-3 text-xs font-bold uppercase tracking-wide text-text-muted">
                    {t("colStatus")}
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-text-muted">
                    {t("colActions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {types.map((ct) => (
                  <tr
                    key={ct.id}
                    className={`border-b border-border last:border-0 transition-colors hover:bg-bg-page ${!ct.active ? "opacity-[0.55]" : ""}`}
                  >
                    {/* Code chip */}
                    <td className="px-3 py-3">
                      <span className="inline-block rounded-sm border border-border bg-bg-page px-2 py-0.5 font-mono text-xs text-text-muted">
                        {ct.code}
                      </span>
                    </td>

                    {/* Name */}
                    <td className="px-3 py-3 font-semibold text-text-body">
                      {ct.name}
                    </td>

                    {/* Category chip */}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-bold text-[12.5px] text-text-heading">
                        <span className="flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-md bg-primary-softer text-primary-dark">
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                            <circle cx="6.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
                          </svg>
                        </span>
                        <span>{ct.category.name}</span>
                      </div>
                    </td>

                    {/* Fields count badge */}
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center rounded-pill bg-primary-softer px-3 py-1 text-xs font-bold text-primary-dark">
                        {ct.fieldsSchema.length === 0
                          ? "—"
                          : `${ct.fieldsSchema.length} ${ct.fieldsSchema.length === 1 ? "field" : "fields"}`}
                      </span>
                    </td>

                    {/* Status pill */}
                    <td className="px-3 py-3">
                      {ct.active ? (
                        <span className="inline-flex items-center rounded-pill bg-status-paid-bg px-3 py-0.5 text-xs font-bold text-status-paid-text">
                          {t("statusActive")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-pill bg-bg-page px-3 py-0.5 text-xs font-bold text-text-muted">
                          {t("statusInactive")}
                        </span>
                      )}
                    </td>

                    {/* Edit action */}
                    <td className="px-3 py-3 text-right">
                      <Link
                        href={`${base}/admin/components/${ct.id}`}
                        className="inline-flex items-center gap-1.5 rounded-sm bg-primary-softer px-3 py-1.5 text-xs font-bold text-primary-dark hover:bg-primary-soft transition-colors"
                      >
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        {t("editPageTitle")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
