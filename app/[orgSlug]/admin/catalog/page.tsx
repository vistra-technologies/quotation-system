import { redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { CatalogExplorer } from "./catalog-explorer";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── API response types ──────────────────────────────────────────────────────

interface ComponentTypeRow {
  id: string;
  code: string;
  name: string;
  fieldsSchema: FieldEntry[];
  // Stage 20 Batch 4: the list route now returns this for free (folded into
  // lib/data/components.ts listComponentTypes) — see the fetch below, no more per-type round trip.
  fieldOptionsConfig: FieldOptionsConfig | null;
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Catalog page (Server Component) — Stage 20 Batch 3, UI replaced in Stage 27.
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
 * Fetches the type roster from the component-types list route, which as of Stage 20 Batch 4
 * returns `fieldOptionsConfig` alongside `fieldsSchema` for every type in one call (folded into
 * `lib/data/components.ts` `listComponentTypes` — see review-B3 MINOR #3/#4). Batch 3 originally
 * did one extra `.../field-values` GET per configurable type (N+1, observed N=34 on acme-glass);
 * that round-trip is gone now that the list response already carries the config.
 *
 * Stage 27: the per-type flat-list `<CatalogTypeEditor>` (one instance per ComponentType) was
 * replaced by a single `<CatalogExplorer>` client component that owns segment tabs + a visual
 * dependency-tree canvas across all configurable types at once (segment tabs are cross-type, so
 * the client component needs the whole array, not one instance per type). This server component's
 * fetch/gate/filter logic is otherwise unchanged.
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

  const withConfig = configurableTypes.map((ct) => ({
    ...ct,
    fieldOptionsConfig: ct.fieldOptionsConfig ?? ({} as FieldOptionsConfig),
  }));

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
        <div className="mt-6">
          <CatalogExplorer orgSlug={orgSlug} componentTypes={withConfig} />
        </div>
      )}
    </div>
  );
}
