import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { upsertItemPrice, deleteItemPrice } from "../actions";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── API response types ──────────────────────────────────────────────────────

interface ItemPriceRow {
  id: string;
  currency: string;
  price: string | number;
}

interface CatalogItemDetail {
  id: string;
  category: string;
  code: string;
  name: string;
  unitOfMeasure: string;
  prices: ItemPriceRow[];
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Pricing item edit page (Server Component).
 *
 * Shows the current prices for one CatalogItem and lets company members add,
 * update, or delete ItemPrice rows.
 *
 * Stage 12: switched from direct requireSession + DAL calls to internalFetch
 * against GET /api/v1/orgs/[orgSlug]/catalog/[itemId]. RBAC (MANAGE_PRICING)
 * is enforced by the route handler — 401/403 redirect to login, 404 → notFound().
 *
 * deleteItemPrice closure updated to pass item.id (needed to build the
 * DELETE /catalog/[itemId]/prices URL — see actions.ts for the updated signature).
 */
export default async function PricingItemPage({
  params,
}: {
  params: Promise<{ orgSlug: string; itemId: string }>;
}) {
  const { orgSlug, itemId } = await params;

  const [itemRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/catalog/${itemId}`),
    getTranslations("pricing"),
  ]);

  if (itemRes.status === 401 || itemRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (itemRes.status === 404) {
    notFound();
  }

  if (!itemRes.ok) {
    notFound();
  }

  const item = ((await itemRes.json()) as { item: CatalogItemDetail }).item;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 px-6 py-8 dark:bg-zinc-950">
      <main className="mx-auto w-full max-w-lg">
        <Link
          href={`/${orgSlug}/pricing`}
          className="mb-4 inline-block text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
        >
          {t("backToList")}
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("editPageTitle")}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {t("editPageSubtitle")}
        </p>

        {/* Item metadata */}
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">{t("colCategory")}</dt>
              <dd className="font-mono text-xs font-medium text-zinc-900 dark:text-zinc-50">
                {item.category}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">{t("colCode")}</dt>
              <dd className="font-mono text-xs font-medium text-zinc-900 dark:text-zinc-50">
                {item.code}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">{t("colName")}</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                {item.name}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">{t("colUOM")}</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                {item.unitOfMeasure}
              </dd>
            </div>
          </dl>
        </div>

        {/* Current prices */}
        {item.prices.length > 0 && (
          <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("colPrices")}
              </h2>
            </div>
            <ul>
              {item.prices.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 last:border-0 dark:border-zinc-800"
                >
                  <span className="text-sm text-zinc-900 dark:text-zinc-50">
                    <span className="font-mono text-xs font-semibold">{p.currency}</span>
                    {" "}
                    {Number(p.price).toFixed(2)}
                  </span>
                  <form
                    action={async () => {
                      "use server";
                      await deleteItemPrice(p.id, item.id, orgSlug);
                    }}
                  >
                    <button
                      type="submit"
                      className="text-sm text-red-600 underline-offset-2 hover:underline dark:text-red-400"
                    >
                      {t("delete")}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Add / Update price form */}
        <div className="mt-6 rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t("addPrice")}
          </h2>
          <form action={upsertItemPrice} className="flex flex-col gap-4">
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="orgSlug" value={orgSlug} />

            <div className="flex flex-col gap-1">
              <label
                htmlFor="currency"
                className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
              >
                {t("currency")}
              </label>
              <input
                id="currency"
                name="currency"
                type="text"
                maxLength={3}
                placeholder="AED"
                required
                className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="price"
                className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
              >
                {t("price")}
              </label>
              <input
                id="price"
                name="price"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                required
                className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
              />
            </div>

            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {t("save")}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
