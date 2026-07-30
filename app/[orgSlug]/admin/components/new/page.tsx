import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { requireSession, requirePermissionFor } from "@/lib/data/session";
import { listComponentCategories } from "@/lib/data/components";
import { orgHref } from "@/lib/orgHref";
import { CreateComponentForm } from "./create-component-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create-ComponentType page (Server Component shell).
 *
 * Handles auth + RBAC gate server-side, then delegates form rendering to the
 * CreateComponentForm Client Component.
 *
 * Stage 11 Batch 7: restyled to Sage Ease tokens — back link, heading, inert
 * caveat, card wrapper. Form inputs updated in create-component-form.tsx.
 * No logic changes.
 */
export default async function NewComponentTypePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");
  const session = await requireSession(orgSlug);
  await requirePermissionFor(session, PERMISSIONS.MANAGE_FEATURES, orgSlug);

  const [categories, t] = await Promise.all([
    listComponentCategories(session),
    getTranslations("components"),
  ]);

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
          {t("createPageTitle")}
        </h1>
        <p className="mt-1 text-[13.5px] text-text-muted">
          {t("createPageSubtitle")}
        </p>
      </div>

      {/* Inert schema-only notice */}
      <aside className="mb-5 rounded-sm border border-status-pending-bg bg-status-pending-bg px-4 py-2.5 text-sm text-status-pending-text">
        {t("inertCaveat")}
      </aside>

      {/* Form card */}
      <div className="max-w-2xl rounded-md border border-border bg-bg-card shadow-card px-6 py-5">
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
