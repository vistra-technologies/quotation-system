import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { specFieldList } from "@/lib/product-pricing/spec-fields";
import { unitForCode, type ComponentTypeInput } from "@/lib/quick-estimate/palette";
import { UNIT_AREA } from "@/lib/quick-estimate/estimate";
import type { StoredPricingRow } from "@/lib/product-pricing/grid";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { ProductPricingView, type PricingType } from "./_product-pricing-view";

// Always render live: reads the session cookie and the DB.
export const dynamic = "force-dynamic";

/**
 * Product Pricing admin page (Stage 36 Batch 3, S36-15). Server Component.
 *
 * Page guard is the pricing GET itself (MANAGE_PRICING): 401/403 redirects to login exactly like
 * admin/inventory/page.tsx. Any other failure degrades to an in-table banner, never a full-page error.
 * Combinations are generated on the client from the shared generator over the fields trimmed here.
 */
export default async function ProductPricingPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;

  const [pricingRes, typesRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/product-pricing`),
    internalFetch(`/api/v1/orgs/${orgSlug}/component-types`),
    getTranslations("productPricing"),
  ]);

  if (pricingRes.status === 401 || pricingRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  let loadError = !pricingRes.ok || !typesRes.ok;
  let rows: StoredPricingRow[] = [];
  let types: PricingType[] = [];
  if (!loadError) {
    try {
      rows = ((await pricingRes.json()) as { rows: StoredPricingRow[] }).rows;
      const cts = ((await typesRes.json()) as { componentTypes: ComponentTypeInput[] }).componentTypes;
      types = cts
        .filter((ct) => ct.active)
        .map((ct) => {
          const fields = specFieldList(ct.fieldsSchema);
          const config = ct.fieldOptionsConfig ?? {};
          const options: FieldOptionsConfig = {};
          for (const f of fields) if (config[f.key]) options[f.key] = config[f.key];
          return { id: ct.id, code: ct.code, name: ct.name, isArea: unitForCode(ct.code) === UNIT_AREA, fields, options };
        });
    } catch {
      loadError = true;
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight text-text-heading">{t("pageTitle")}</h1>
      <div className="mt-5">
        <ProductPricingView orgSlug={orgSlug} types={types} initialRows={rows} loadError={loadError} />
      </div>
    </div>
  );
}
