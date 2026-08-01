import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import type { FieldEntry } from "@/lib/types/field-entry";
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
 * Stage 12 Batch 6: switched from requireSession/requirePermissionFor/getComponentTypeById/
 * listComponentCategories DAL to internalFetch against /component-types/[typeId]
 * and /component-categories. Auth check comes from the 401/403 the API routes return —
 * GET /component-types/[typeId] is MANAGE_FEATURES gated, so 403 means no permission.
 */
export default async function EditComponentTypePage({
  params,
}: {
  params: Promise<{ orgSlug: string; typeId: string }>;
}) {
  const { orgSlug, typeId } = await params;
  const base = await orgHref(orgSlug, "");

  const [ctRes, categoriesRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/component-types/${typeId}`),
    internalFetch(`/api/v1/orgs/${orgSlug}/component-categories`),
    getTranslations("components"),
  ]);

  if (ctRes.status === 401 || categoriesRes.status === 401) {
    redirect(await orgHref(orgSlug, "/login"));
  }
  if (ctRes.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));
  if (ctRes.status === 404) notFound();

  const { componentType: ct } = (await ctRes.json()) as {
    componentType: {
      id: string;
      code: string;
      name: string;
      active: boolean;
      categoryId: string;
      fieldsSchema: FieldEntry[];
    };
  };
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
