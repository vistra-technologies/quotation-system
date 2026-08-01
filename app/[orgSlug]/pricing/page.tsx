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
 * Gated on MANAGE_PRICING — wrong-role requests are redirected to the dashboard.
 *
 * Stage 11 (Batch 9): restyled to Sage Ease tokens; removed incorrect
 * min-h-screen outer wrapper (page renders inside the org app shell).
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
  const base = await orgHref(orgSlug, "");

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

  const base = await orgHref(orgSlug, "");

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
