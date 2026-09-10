import Link from "next/link";
import { internalFetch } from "@/lib/internal-fetch";
import { OrgPicker } from "../roles/org-picker";
import { CreateComponentForm } from "./create-component-form";
import { EditComponentForm } from "./edit-component-form";
import { DeleteComponentTypeButton } from "./_delete-button";
import type { FieldEntry } from "@/lib/types/field-entry";

// Always render live — reads the SuperAdminSession table (via guard layout) and live DB.
export const dynamic = "force-dynamic";

// ─── API response types ────────────────────────────────────────────────────────

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  isSuspended: boolean;
  createdAt: string;
  userCount: number;
}

interface CategoryRow {
  id: string;
  name: string;
  organizationId: string;
}

interface ComponentTypeRow {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  active: boolean;
  categoryId: string;
  category: { id: string; name: string };
  fieldsSchema: FieldEntry[];
}

// ─── Label constants ───────────────────────────────────────────────────────────
//
// /controls is translation-free (English only, SuperAdmin-only console).

const FORM_LABELS = {
  create: {
    fieldCodeLabel: "Code",
    fieldCodeHint: "Uppercase letters and underscores, e.g. WALL_TYPE. Saved as-is.",
    fieldNameLabel: "Name",
    fieldCategoryLabel: "Category",
    fieldCategoryPlaceholder: "Select category",
    fieldsSchemaLabel: "Field Schema",
    sectionBasic: "Basic Fields",
    sectionAdvanced: "Advanced Fields",
    addFieldLabel: "Add Field",
    removeFieldLabel: "Remove",
    fieldKeyLabel: "Key",
    fieldLabelLabel: "Label",
    fieldTypeLabel: "Type",
    fieldTypeField: "Field (text)",
    fieldTypeRadio: "Radio",
    fieldTypeDropdown: "Dropdown",
    fieldTypeCheckbox: "Checkbox",
    fieldOptions: "Options",
    addOption: "Add",
    fieldHint: "Hint",
    fieldRequiredLabel: "Required",
    moveUp: "Move up",
    moveDown: "Move down",
    fieldStatusLabel: "Active",
    submitLabel: "Create Component Type",
    modeForm: "Form",
    modeJson: "JSON",
    jsonErrorBadJson: "Invalid JSON:",
    jsonErrorBadShape: "Invalid schema:",
  },
  edit: {
    fieldNameLabel: "Name",
    fieldCategoryLabel: "Category",
    fieldCategoryPlaceholder: "Select category",
    fieldStatusLabel: "Active",
    fieldsSchemaLabel: "Field Schema",
    sectionBasic: "Basic Fields",
    sectionAdvanced: "Advanced Fields",
    addFieldLabel: "Add Field",
    removeFieldLabel: "Remove",
    fieldKeyLabel: "Key",
    fieldLabelLabel: "Label",
    fieldTypeLabel: "Type",
    fieldTypeField: "Field (text)",
    fieldTypeRadio: "Radio",
    fieldTypeDropdown: "Dropdown",
    fieldTypeCheckbox: "Checkbox",
    fieldOptions: "Options",
    addOption: "Add",
    fieldHint: "Hint",
    fieldRequiredLabel: "Required",
    moveUp: "Move up",
    moveDown: "Move down",
    submitLabel: "Save Changes",
    modeForm: "Form",
    modeJson: "JSON",
    jsonErrorBadJson: "Invalid JSON:",
    jsonErrorBadShape: "Invalid schema:",
  },
} as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * SuperAdmin Component Types console (Server Component).
 *
 * URL state:
 *   /controls/component-types               — org picker only (no org selected)
 *   /controls/component-types?orgId=xxx     — org selected; shows that org's types + create form
 *   /controls/component-types?orgId=xxx&typeId=yyy — type selected; shows edit form
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx.
 *
 * UI/API separation (Stage 12 pattern): data fetched via internalFetch → the
 * qs-sa-token cookie is forwarded so route handlers' requireSuperAdminFromRequest()
 * sees the session.
 *
 * Stage 19 Batch 5 — Component Type management relocated from /admin/components to /controls.
 */
export default async function ComponentTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; typeId?: string }>;
}) {
  const { orgId, typeId } = await searchParams;

  // Always fetch the org list for the picker.
  const orgsRes = await internalFetch("/api/v1/superadmin/orgs");

  if (!orgsRes.ok) {
    return (
      <p className="p-8 text-center text-sm text-status-failed-text">
        Failed to load organizations — please refresh.
      </p>
    );
  }

  const orgs = ((await orgsRes.json()) as { orgs: OrgRow[] }).orgs;

  // Suspended orgs are excluded from the picker — managing component types on a
  // suspended org isn't a supported flow.
  const selectableOrgs = orgs.filter((o) => !o.isSuspended);

  // Resolve selected org metadata (for display in headings).
  const selectedOrg = orgId ? orgs.find((o) => o.id === orgId) ?? null : null;

  // ── Fetch component types and categories for the selected org ────────────────

  let componentTypes: ComponentTypeRow[] | null = null;
  let categories: CategoryRow[] = [];

  if (orgId) {
    const [typesRes, catsRes] = await Promise.all([
      internalFetch(`/api/v1/superadmin/component-types?orgId=${encodeURIComponent(orgId)}`),
      internalFetch(`/api/v1/superadmin/component-categories?orgId=${encodeURIComponent(orgId)}`),
    ]);

    if (typesRes.ok) {
      componentTypes = ((await typesRes.json()) as { componentTypes: ComponentTypeRow[] }).componentTypes;
    } else if (typesRes.status !== 404) {
      return (
        <p className="p-8 text-center text-sm text-status-failed-text">
          Failed to load component types — please refresh.
        </p>
      );
    }

    if (catsRes.ok) {
      categories = ((await catsRes.json()) as { categories: CategoryRow[] }).categories;
    }
  }

  // ── Resolve selected type for edit form ────────────────────────────────────

  const selectedType = typeId && componentTypes
    ? componentTypes.find((t) => t.id === typeId) ?? null
    : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-text-heading">Component Types</h1>
        <p className="mt-1 text-sm text-text-muted">
          Manage Component Types and their field schemas for any organization.
          Component Types are available in the Configuration step once created.
        </p>
      </div>

      {/* ── Org picker ── */}
      <div className="mt-6 max-w-sm">
        <OrgPicker
          orgs={selectableOrgs}
          selectedOrgId={orgId ?? null}
          basePath="/controls/component-types"
        />
      </div>

      {/* ── Component Types section (only when an org is selected) ── */}
      {orgId && selectedOrg && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-text-heading">
            Component Types — {selectedOrg.name}
          </h2>

          {/* ── Type list ── */}
          {componentTypes && componentTypes.length > 0 ? (
            <div className="mt-4 rounded-md border border-border bg-bg-card shadow-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                        Code
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                        Name
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                        Category
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                        Fields
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                        Status
                      </th>
                      <th className="px-5 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-text-muted">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {componentTypes.map((ct) => {
                      const isSelected = ct.id === typeId;
                      return (
                        <tr
                          key={ct.id}
                          className={isSelected ? "bg-primary-softer/30" : "hover:bg-primary-softer/20"}
                        >
                          <td className="px-5 py-4">
                            <span className="rounded-sm bg-bg-subtle px-1.5 py-0.5 font-mono text-xs font-semibold text-text-heading">
                              {ct.code}
                            </span>
                          </td>
                          <td className="px-5 py-4 font-semibold text-text-heading">
                            {ct.name}
                          </td>
                          <td className="px-5 py-4 text-text-muted">
                            {ct.category.name}
                          </td>
                          <td className="px-5 py-4">
                            <span className="rounded-pill bg-bg-subtle px-2 py-0.5 text-xs text-text-muted">
                              {ct.fieldsSchema.length} field{ct.fieldsSchema.length !== 1 ? "s" : ""}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            {ct.active ? (
                              <span className="rounded-pill bg-status-success-bg px-2 py-0.5 text-xs font-semibold text-status-success-text">
                                Active
                              </span>
                            ) : (
                              <span className="rounded-pill bg-bg-subtle px-2 py-0.5 text-xs font-semibold text-text-muted">
                                Inactive
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <div className="flex items-center justify-end gap-4">
                              <Link
                                href={`/controls/component-types?orgId=${encodeURIComponent(orgId)}&typeId=${encodeURIComponent(ct.id)}`}
                                className="text-sm font-semibold text-primary hover:text-primary-dark"
                              >
                                {isSelected ? "Editing" : "Edit"}
                              </Link>
                              <DeleteComponentTypeButton
                                orgId={orgId}
                                typeId={ct.id}
                                typeCode={ct.code}
                                typeName={ct.name}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : componentTypes !== null ? (
            <p className="mt-4 text-sm text-text-muted">
              No component types found for this organization.
            </p>
          ) : null}

          {/* ── Edit form (when a type is selected) ── */}
          {typeId && selectedType && (
            <div className="mt-8">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-text-heading">
                  Edit:{" "}
                  <span className="font-mono text-sm font-semibold text-text-muted">
                    {selectedType.code}
                  </span>{" "}
                  — {selectedType.name}
                </h3>
                <Link
                  href={`/controls/component-types?orgId=${encodeURIComponent(orgId)}`}
                  className="text-sm text-text-muted hover:text-text-heading"
                >
                  ← Back to list
                </Link>
              </div>
              <div className="mt-4 rounded-md border border-border bg-bg-card px-5 py-5 shadow-card">
                {/* key={selectedType.id} forces React to unmount+remount the form when a
                    different type is selected while an edit is already open (M2 fix — bugs-3.md).
                    Without this, useState in EditComponentForm retains stale values from the
                    previous edit target (the "Editing" indicator moves but the form doesn't reset). */}
                <EditComponentForm
                  key={selectedType.id}
                  orgId={orgId}
                  typeId={selectedType.id}
                  initialName={selectedType.name}
                  initialCategoryId={selectedType.categoryId}
                  initialActive={selectedType.active}
                  initialFields={selectedType.fieldsSchema}
                  categories={categories}
                  labels={FORM_LABELS.edit}
                />
              </div>
            </div>
          )}

          {/* ── Create form (when no type is selected) ── */}
          {!typeId && (
            <div className="mt-8">
              <h3 className="text-sm font-bold text-text-heading">Create new component type</h3>
              <aside className="mt-3 rounded-sm border border-status-pending-border bg-status-pending-bg px-4 py-3 text-sm text-status-pending-text">
                Component Types define the configurable fields for selections. Fields added here are
                available in the Configuration step but are inert until wired to the BOQ engine.
              </aside>
              <div className="mt-3 rounded-md border border-border bg-bg-card px-5 py-5 shadow-card">
                <CreateComponentForm
                  orgId={orgId}
                  categories={categories}
                  labels={FORM_LABELS.create}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Placeholder when no org is selected ── */}
      {!orgId && (
        <p className="mt-8 text-sm text-text-muted">
          Select an organization above to view and manage its component types.
        </p>
      )}
    </div>
  );
}
