import { redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { CatalogTypeEditor } from "./catalog-type-editor";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── API response types ──────────────────────────────────────────────────────

interface ComponentTypeRow {
  id: string;
  code: string;
  name: string;
  fieldsSchema: FieldEntry[];
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Catalog page (Server Component) — Stage 20 Batch 3.
 *
 * Nav label locked as "Catalog" (decision #2, stage-20.md). Lets an org admin fill in the
 * option values for every dropdown/radio field on every ComponentType — the SuperAdmin-authored
 * `fieldsSchema` (shape + `dependsOn` wiring) is read-only here; only `fieldOptionsConfig`
 * (values) is editable.
 *
 * Gated on MANAGE_FEATURES specifically (unlike the broader MANAGE_USERS-or-MANAGE_FEATURES gate
 * on the parent `/admin/*` layout) — same page-level pattern as
 * `app/[orgSlug]/admin/external-companies/page.tsx`'s MANAGE_USERS check.
 *
 * Fetches the type roster from the existing (unmodified) component-types list route, then one
 * field-values GET per type that has at least one dropdown/radio field — see item-B3-plan.md for
 * why this batch doesn't fold config into the shared list route (that's Batch 4's job, scoped to
 * wherever the Configurator loads types).
 */
export default async function FieldValuesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const meRes = await internalFetch(`/api/v1/orgs/${orgSlug}/me`);
  if (meRes.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (meRes.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  const me = (await meRes.json()) as { adminPermissions: string[] };
  if (!me.adminPermissions.includes("MANAGE_FEATURES")) {
    redirect(await orgHref(orgSlug, "/dashboard"));
  }

  const listRes = await internalFetch(
    `/api/v1/orgs/${orgSlug}/component-types`,
  );
  if (!listRes.ok) {
    redirect(await orgHref(orgSlug, "/dashboard"));
  }
  const { componentTypes } = (await listRes.json()) as {
    componentTypes: ComponentTypeRow[];
  };

  // Types with no dropdown/radio field have nothing to configure here — skip them
  // rather than rendering an empty section.
  const configurableTypes = componentTypes.filter((ct) =>
    ct.fieldsSchema.some((f) => f.type === "dropdown" || f.type === "radio"),
  );

  const withConfig = await Promise.all(
    configurableTypes.map(async (ct) => {
      const res = await internalFetch(
        `/api/v1/orgs/${orgSlug}/component-types/${ct.id}/field-values`,
      );
      if (!res.ok) {
        return { ...ct, fieldOptionsConfig: {} as FieldOptionsConfig };
      }
      const body = (await res.json()) as {
        componentType: { fieldOptionsConfig: FieldOptionsConfig | null };
      };
      return {
        ...ct,
        fieldOptionsConfig: body.componentType.fieldOptionsConfig ?? {},
      };
    }),
  );

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold text-text-heading">Catalog</h1>
        <p className="mt-1 text-sm text-text-muted">
          Configure the dropdown/radio value lists your organization sees when adding components.
          Field shape and dependency wiring are set by your platform admin and shown read-only
          here.
        </p>
      </div>

      {withConfig.length === 0 ? (
        <p className="mt-6 text-sm text-text-muted">
          No component type currently has a dropdown or radio field to configure.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {withConfig.map((ct) => (
            <CatalogTypeEditor
              key={ct.id}
              orgSlug={orgSlug}
              typeId={ct.id}
              code={ct.code}
              name={ct.name}
              fieldsSchema={ct.fieldsSchema}
              initialFieldOptionsConfig={ct.fieldOptionsConfig}
            />
          ))}
        </div>
      )}
    </div>
  );
}
