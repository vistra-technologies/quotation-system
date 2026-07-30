import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { listCatalogItems } from "@/lib/data/catalog";
import { requireSession, requirePermissionFor } from "@/lib/data/session";
import { orgHref } from "@/lib/orgHref";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Pricing management list page (Server Component).
 *
 * Lists all active catalog items for the org with their current prices.
 * Gated on MANAGE_PRICING — wrong-role requests are redirected to the dashboard.
 *
 * Stage 11 (Batch 9): restyled to Sage Ease tokens; removed incorrect
 * min-h-screen outer wrapper (page renders inside the org app shell).
 */
export default async function PricingPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");
  const session = await requireSession(orgSlug);
  await requirePermissionFor(session, PERMISSIONS.MANAGE_PRICING, orgSlug);

  const [items, t] = await Promise.all([
    listCatalogItems(session),
    getTranslations("pricing"),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight text-text-heading">
        {t("pageTitle")}
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        {t("pageSubtitle")}
      </p>

      <div className="mt-6 rounded-md border border-border bg-bg-card shadow-card">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-bold text-text-body">
            {t("itemsTableHeading")}
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colCategory")}
                </th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colCode")}
                </th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colName")}
                </th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colUOM")}
                </th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colPrices")}
                </th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="hover:bg-primary-softer/40"
                >
                  <td className="px-5 py-4 font-mono text-xs text-text-muted">
                    {item.category}
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-text-muted">
                    {item.code}
                  </td>
                  <td className="px-5 py-4 text-text-heading">
                    {item.name}
                  </td>
                  <td className="px-5 py-4 text-text-body">
                    {item.unitOfMeasure}
                  </td>
                  <td className="px-5 py-4 text-text-body">
                    {item.prices.length === 0 ? (
                      <span className="text-text-muted">
                        {t("noPrices")}
                      </span>
                    ) : (
                      <span>
                        {item.prices
                          .map((p) => `${p.currency}: ${Number(p.price).toFixed(2)}`)
                          .join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`${base}/pricing/${item.id}`}
                      className="text-sm font-semibold text-primary hover:text-primary-dark"
                    >
                      {t("editPrices")}
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
