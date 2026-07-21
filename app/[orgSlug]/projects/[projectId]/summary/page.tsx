import { getTranslations } from "next-intl/server";

/**
 * Summary page — Step 4 of the project wizard (Server Component).
 *
 * Inert placeholder. The Design Summary content arrives in Stage 10.
 */
export default async function SummaryPage() {
  const t = await getTranslations("wizard");

  return (
    <div className="flex items-center justify-center py-24">
      <p className="text-sm text-zinc-400 dark:text-zinc-600">
        {t("summaryPlaceholder")}
      </p>
    </div>
  );
}
