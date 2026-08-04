import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
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
 * Stage 12 Batch 6: switched from requireSession/requirePermissionFor/listComponentCategories
 * DAL to internalFetch against /me (MANAGE_FEATURES check) and /component-categories.
 */
export default async function NewComponentTypePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");

  const [meRes, categoriesRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/me`),
    internalFetch(`/api/v1/orgs/${orgSlug}/component-categories`),
    getTranslations("components"),
  ]);

  if (meRes.status === 401 || categoriesRes.status === 401) {
    redirect(await orgHref(orgSlug, "/login"));
  }
  if (meRes.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  const me = (await meRes.json()) as { adminPermissions: string[] };
  if (!me.adminPermissions.includes("MANAGE_FEATURES")) {
    redirect(await orgHref(orgSlug, "/dashboard"));
  }

  const { categories } = (await categoriesRes.json()) as {
    categories: { id: string; name: string }[];
  };

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
