import { getTranslations } from "next-intl/server";

/**
 * Quotation page — Step 5 of the project wizard (Server Component).
 *
 * Inert placeholder. The Quotation pipeline arrives in a future stage.
 */
export default async function QuotationPage() {
  const t = await getTranslations("wizard");

  return (
    <div className="flex items-center justify-center py-24">
      <p className="text-sm text-zinc-400 dark:text-zinc-600">
        {t("quotationPlaceholder")}
      </p>
    </div>
  );
}
