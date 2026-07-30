import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { getComponentTypeById, listComponentCategories } from "@/lib/data/components";
import { requireSession, requirePermissionFor } from "@/lib/data/session";
import { orgHref } from "@/lib/orgHref";
import { EditComponentForm } from "./edit-component-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * ComponentType edit page (Server Component shell).
 *
 * Loads the ComponentType by id (org-scoped), then renders the
 * EditComponentForm Client Component with the current values.
 * Gated on MANAGE_FEATURES.
 *
 * Stage 11 Batch 7: restyled to Sage Ease tokens — back link, heading, code
 * display, inert caveat, card wrapper. Form inputs updated in
 * edit-component-form.tsx. No logic changes.
 */
export default async function EditComponentTypePage({
  params,
}: {
  params: Promise<{ orgSlug: string; typeId: string }>;
}) {
  const { orgSlug, typeId } = await params;
  const base = await orgHref(orgSlug, "");
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
      {/* Back link */}
      <Link
        href={`${base}/admin/components`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        {t("backToList")}
      </Link>

      {/* Page heading */}
      <div className="mb-5">
        <h1 className="text-[27px] font-extrabold text-text-heading leading-tight">
          {t("editPageTitle")}
        </h1>
        <p className="mt-1 font-mono text-sm font-bold text-text-muted">{ct.code}</p>
      </div>

      {/* Inert schema-only notice */}
      <aside className="mb-5 rounded-sm border border-status-pending-bg bg-status-pending-bg px-4 py-2.5 text-sm text-status-pending-text">
        {t("inertCaveat")}
      </aside>

      {/* Form card */}
      <div className="max-w-2xl rounded-md border border-border bg-bg-card shadow-card px-6 py-5">
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
