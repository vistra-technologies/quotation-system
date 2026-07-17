import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { listCatalogItems } from "@/lib/data/catalog";
import { requireSession, requirePermissionFor } from "@/lib/data/session";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Pricing management list page (Server Component).
 *
 * Lists all active catalog items for the org with their current prices.
 * Gated on MANAGE_PRICING — wrong-role requests are redirected to the dashboard.
 */
export default async function PricingPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await requireSession(orgSlug);
  await requirePermissionFor(session, PERMISSIONS.MANAGE_PRICING, orgSlug);

  const [items, t] = await Promise.all([
    listCatalogItems(session),
    getTranslations("pricing"),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 px-6 py-8 dark:bg-zinc-950">
      <main className="mx-auto w-full max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("pageTitle")}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {t("pageSubtitle")}
        </p>

        <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("itemsTableHeading")}
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                  <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                    {t("colCategory")}
                  </th>
                  <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                    {t("colCode")}
                  </th>
                  <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                    {t("colName")}
                  </th>
                  <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                    {t("colUOM")}
                  </th>
                  <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                    {t("colPrices")}
                  </th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                  >
                    <td className="px-5 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                      {item.category}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                      {item.code}
                    </td>
                    <td className="px-5 py-3 text-zinc-900 dark:text-zinc-50">
                      {item.name}
                    </td>
                    <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">
                      {item.unitOfMeasure}
                    </td>
                    <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">
                      {item.prices.length === 0 ? (
                        <span className="text-zinc-400 dark:text-zinc-500">
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
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/${orgSlug}/pricing/${item.id}`}
                        className="text-sm font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
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
      </main>
    </div>
  );
}
