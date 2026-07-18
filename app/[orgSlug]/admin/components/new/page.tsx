import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { requireSession, requirePermissionFor } from "@/lib/data/session";
import { listComponentCategories } from "@/lib/data/components";
import { CreateComponentForm } from "./create-component-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create-ComponentType page (Server Component shell).
 *
 * Handles auth + RBAC gate server-side, then delegates form rendering to the
 * CreateComponentForm Client Component.
 */
export default async function NewComponentTypePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await requireSession(orgSlug);
  await requirePermissionFor(session, PERMISSIONS.MANAGE_FEATURES, orgSlug);

  const [categories, t] = await Promise.all([
    listComponentCategories(session),
    getTranslations("components"),
  ]);

  return (
    <div>
      <Link
        href={`/${orgSlug}/admin/components`}
        className="mb-4 inline-block text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        {t("backToList")}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t("createPageTitle")}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {t("createPageSubtitle")}
      </p>

      {/* Inert caveat — prominently displayed on the create form */}
      <aside className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        {t("inertCaveat")}
      </aside>

      <div className="mt-6 max-w-2xl rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <CreateComponentForm
          orgSlug={orgSlug}
          categories={categories}
          labels={{
            fieldCodeLabel: t("fieldCode"),
            fieldCodeHint: t("fieldCodeHint"),
            fieldNameLabel: t("fieldName"),
            fieldCategoryLabel: t("fieldCategory"),
            fieldCategoryPlaceholder: t("fieldCategoryPlaceholder"),
            fieldsSchemaLabel: t("fieldsSchemaLabel"),
            sectionBasic: t("sectionBasic"),
            sectionAdvanced: t("sectionAdvanced"),
            addFieldLabel: t("addField"),
            removeFieldLabel: t("removeField"),
            fieldKeyLabel: t("fieldKey"),
            fieldLabelLabel: t("fieldLabel"),
            fieldTypeLabel: t("fieldType"),
            fieldTypeField: t("fieldTypeField"),
            fieldTypeRadio: t("fieldTypeRadio"),
            fieldTypeDropdown: t("fieldTypeDropdown"),
            fieldTypeCheckbox: t("fieldTypeCheckbox"),
            fieldOptions: t("fieldOptions"),
            addOption: t("addOption"),
            fieldHint: t("fieldHint"),
            fieldRequiredLabel: t("fieldRequired"),
            moveUp: t("moveUp"),
            moveDown: t("moveDown"),
            fieldStatusLabel: t("fieldStatus"),
            submitLabel: t("submitCreate"),
            modeForm: t("modeForm"),
            modeJson: t("modeJson"),
            jsonErrorBadJson: t("jsonErrorBadJson"),
            jsonErrorBadShape: t("jsonErrorBadShape"),
          }}
        />
      </div>
    </div>
  );
}
