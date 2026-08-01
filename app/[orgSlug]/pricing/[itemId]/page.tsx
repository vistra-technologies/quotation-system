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
 * update, or delete ItemPrice rows.  Gated on MANAGE_PRICING.
 *
 * Stage 11 (Batch 9): restyled to Sage Ease tokens; removed incorrect
 * min-h-screen outer wrapper (page renders inside the org app shell).
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

  const base = await orgHref(orgSlug, "");

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-8">
      <Link
        href={`${base}/pricing`}
        className="mb-4 inline-block text-sm text-text-muted hover:text-text-heading"
      >
        {t("backToList")}
      </Link>

      <h1 className="text-2xl font-extrabold tracking-tight text-text-heading">
        {t("editPageTitle")}
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        {t("editPageSubtitle")}
      </p>

      {/* Item metadata */}
      <div className="mt-4 rounded-md border border-border bg-bg-card px-5 py-4 shadow-card">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">{t("colCategory")}</dt>
            <dd className="font-mono text-xs font-semibold text-text-heading">
              {item.category}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">{t("colCode")}</dt>
            <dd className="font-mono text-xs font-semibold text-text-heading">
              {item.code}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">{t("colName")}</dt>
            <dd className="font-semibold text-text-heading">
              {item.name}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">{t("colUOM")}</dt>
            <dd className="font-semibold text-text-heading">
              {item.unitOfMeasure}
            </dd>
          </div>
        </dl>
      </div>

      {/* Current prices */}
      {item.prices.length > 0 && (
        <div className="mt-6 rounded-md border border-border bg-bg-card shadow-card">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-bold text-text-body">
              {t("colPrices")}
            </h2>
          </div>
          <ul className="divide-y divide-border">
            {item.prices.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between px-5 py-3"
              >
                <span className="text-sm text-text-heading">
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
                    className="text-sm font-semibold text-red-600 underline-offset-2 hover:underline"
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
      <div className="mt-6 rounded-md border border-border bg-bg-card px-5 py-4 shadow-card">
        <h2 className="mb-4 text-sm font-bold text-text-body">
          {t("addPrice")}
        </h2>
        <form action={upsertItemPrice} className="flex flex-col gap-4">
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="orgSlug" value={orgSlug} />

          <div className="flex flex-col gap-1">
            <label
              htmlFor="currency"
              className="text-xs font-bold uppercase tracking-wide text-text-muted"
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
              className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-heading placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="price"
              className="text-xs font-bold uppercase tracking-wide text-text-muted"
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
              className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-heading placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <button
            type="submit"
            className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
          >
            {t("save")}
          </button>
        </form>
      </div>
    </div>
  );
}
