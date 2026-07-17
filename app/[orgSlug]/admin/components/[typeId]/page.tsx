import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { getComponentTypeById, isCoreComponentType } from "@/lib/data/components";
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

  const [ct, t] = await Promise.all([
    getComponentTypeById(session, typeId),
    getTranslations("components"),
  ]);

  if (!ct) notFound();

  const isCore = isCoreComponentType(ct.code);

  return (
    <div>
      <Link
        href={`/${orgSlug}/admin/components`}
        className="mb-4 inline-block text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        {t("backToList")}
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("editPageTitle")}
          </h1>
          <p className="mt-1 font-mono text-sm text-zinc-500 dark:text-zinc-400">{ct.code}</p>
        </div>
        <div className="flex items-center gap-2">
          {isCore ? (
            <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
              {t("statusCore")}
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              {t("inertBadge")}
            </span>
          )}
        </div>
      </div>

      {/* Core types also get the inert notice (their field schemas are still inert until Stage 6) */}
      <aside className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        {t("inertCaveat")}
      </aside>

      <div className="mt-6 max-w-2xl rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <EditComponentForm
          orgSlug={orgSlug}
          typeId={ct.id}
          initialName={ct.name}
          initialActive={ct.active}
          initialFields={ct.fieldsSchema}
          isCore={isCore}
          labels={{
            fieldNameLabel: t("fieldName"),
            fieldStatusLabel: t("fieldStatus"),
            fieldsSchemaLabel: t("fieldsSchemaLabel"),
            addFieldLabel: t("addField"),
            removeFieldLabel: t("removeField"),
            fieldKeyLabel: t("fieldKey"),
            fieldLabelLabel: t("fieldLabel"),
            fieldTypeLabel: t("fieldType"),
            fieldRequiredLabel: t("fieldRequired"),
            submitLabel: t("submitUpdate"),
            inertCaveat: t("inertCaveat"),
          }}
        />
      </div>
    </div>
  );
}
