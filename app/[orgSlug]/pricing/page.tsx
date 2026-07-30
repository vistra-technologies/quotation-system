import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── API response types ──────────────────────────────────────────────────────

interface ItemPriceRow {
  id: string;
  currency: string;
  price: string | number;
}

interface CatalogItemRow {
  id: string;
  category: string;
  code: string;
  name: string;
  unitOfMeasure: string;
  prices: ItemPriceRow[];
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Pricing management list page (Server Component).
 *
 * Lists all active catalog items for the org with their current prices.
 *
 * Stage 12: switched from direct requireSession + DAL calls to internalFetch
 * against GET /api/v1/orgs/[orgSlug]/catalog. RBAC (MANAGE_PRICING) is
 * enforced by the route handler — 403 here redirects to login.
 */
export default async function PricingPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [catalogRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/catalog`),
    getTranslations("pricing"),
  ]);

  if (catalogRes.status === 401 || catalogRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  const items: CatalogItemRow[] = catalogRes.ok
    ? ((await catalogRes.json()) as { items: CatalogItemRow[] }).items
    : [];

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
