import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { getComponentTypeById, listComponentCategories } from "@/lib/data/components";
import { requireSession, requirePermissionFor } from "@/lib/data/session";
import { EditComponentForm } from "./edit-component-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * ComponentType edit page (Server Component shell).
 *
 * Loads the ComponentType by id (org-scoped), then renders the
 * EditComponentForm Client Component with the current values.
 * Gated on MANAGE_FEATURES.
 */
export default async function EditComponentTypePage({
  params,
}: {
  params: Promise<{ orgSlug: string; typeId: string }>;
}) {
  const { orgSlug, typeId } = await params;
  const session = await requireSession(orgSlug);
  await requirePermissionFor(session, PERMISSIONS.MANAGE_FEATURES, orgSlug);

  const [ct, categories, t] = await Promise.all([
    getComponentTypeById(session, typeId),
    listComponentCategories(session),
    getTranslations("components"),
  ]);

  if (!ct) notFound();

  return (
    <div>
      <Link
        href={`/${orgSlug}/admin/components`}
        className="mb-4 inline-block text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        {t("backToList")}
      </Link>

      <div className="mt-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("editPageTitle")}
        </h1>
        <p className="mt-1 font-mono text-sm text-zinc-500 dark:text-zinc-400">{ct.code}</p>
      </div>

      <aside className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        {t("inertCaveat")}
      </aside>

      <div className="mt-6 max-w-2xl rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <EditComponentForm
          orgSlug={orgSlug}
          typeId={ct.id}
          initialName={ct.name}
          initialCategoryId={ct.categoryId}
          initialActive={ct.active}
          initialFields={ct.fieldsSchema}
          categories={categories}
          labels={{
            fieldNameLabel: t("fieldName"),
            fieldCategoryLabel: t("fieldCategory"),
            fieldCategoryPlaceholder: t("fieldCategoryPlaceholder"),
            fieldStatusLabel: t("fieldStatus"),
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
            submitLabel: t("submitUpdate"),
          }}
        />
      </div>
    </div>
  );
}
