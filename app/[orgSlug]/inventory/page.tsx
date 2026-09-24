import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── API response types ──────────────────────────────────────────────────────

interface InventoryItemRow {
  id: string;
  category: string;
  code: string;
  name: string;
  measurementUnit: string;
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Inventory management list page (Server Component).
 *
 * Lists all active inventory items for the org.
 * Gated on MANAGE_PRICING — wrong-role requests are redirected to the dashboard.
 *
 * Stage 11 (Batch 9): restyled to Sage Ease tokens; removed incorrect
 * min-h-screen outer wrapper (page renders inside the org app shell).
 * Stage 12: switched from direct requireSession + DAL calls to internalFetch
 * against GET /api/v1/orgs/[orgSlug]/catalog. RBAC (MANAGE_PRICING) is
 * enforced by the route handler — 403 here redirects to login.
 * Stage 25 Batch 6 (S25-4): renamed from /pricing to /inventory; removed
 * prices column and Edit Prices link (S25-7); API route moved to /inventory.
 */
export default async function InventoryPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [inventoryRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/inventory`),
    getTranslations("inventory"),
  ]);

  if (inventoryRes.status === 401 || inventoryRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  const items: InventoryItemRow[] = inventoryRes.ok
    ? ((await inventoryRes.json()) as { items: InventoryItemRow[] }).items
    : [];

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
                    {item.measurementUnit}
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
