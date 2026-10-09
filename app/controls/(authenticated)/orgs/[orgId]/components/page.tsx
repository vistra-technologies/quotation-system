import Link from "next/link";
import { notFound } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { getTranslations } from "next-intl/server";
import { CreateComponentForm } from "../../../component-types/create-component-form";
import { EditComponentForm } from "../../../component-types/edit-component-form";
import { DeleteComponentTypeButton } from "../../../component-types/_delete-button";
import { ReorderButtons } from "../../../component-types/_reorder-buttons";
import { loadWorkspaceOrg } from "../_org";
import type { FieldEntry } from "@/lib/types/field-entry";

// Always render live — reads the SuperAdminSession table (via guard layout) and live DB.
export const dynamic = "force-dynamic";

// ─── API response types ────────────────────────────────────────────────────────

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
  sortOrder: number;
}

// ─── Label constants ───────────────────────────────────────────────────────────
//
// FORM_LABELS is built inside the async page function (H-14) so it can pull a
// subset of strings from getTranslations("components") for the keys that live
// in messages/en.json: fieldsSchemaLabel, fieldCodeHint, modeForm, modeJson,
// fieldNPlaceholder, switchToFormHint. The rest remain hardcoded English — the
// /controls console is SuperAdmin-only and English-only.

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Workspace Components tab (Server Component): one org's Component Types.
 *
 * URL state:
 *   /controls/orgs/[orgId]/components               — the org's types + create form
 *   /controls/orgs/[orgId]/components?typeId=yyy    — type selected; shows edit form
 *
 * `?typeId=` still drives create vs edit. The org comes from the URL (S29-2) and works for a
 * suspended org.
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx.
 *
 * UI/API separation (Stage 12 pattern): data fetched via internalFetch → the
 * qs-sa-token cookie is forwarded so route handlers' requireSuperAdminFromRequest()
 * sees the session.
 *
 * Stage 19 Batch 5 — Component Type management relocated from /admin/components to /controls;
 * moved into the workspace in Stage 29 Batch 1.
 */
export default async function OrgComponentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ typeId?: string }>;
}) {
  const { orgId } = await params;
  const { typeId } = await searchParams;
  const tComponents = await getTranslations("components");

  // H-14: build FORM_LABELS here so the subset of i18n-backed strings can be
  // populated via tComponents(). The rest stay hardcoded English (/controls is
  // SuperAdmin-only and English-only).
  const sharedLabels = {
    fieldCodeHint: tComponents("fieldCodeHint"),
    fieldsSchemaLabel: tComponents("fieldsSchemaLabel"),
    modeForm: tComponents("modeForm"),
    modeJson: tComponents("modeJson"),
    fieldNPlaceholder: tComponents("fieldNPlaceholder"),
    switchToFormHint: tComponents("switchToFormHint"),
  };
  const FORM_LABELS = {
    create: {
      fieldCodeLabel: "Code",
      fieldCodeHint: sharedLabels.fieldCodeHint,
      fieldNameLabel: "Name",
      fieldCategoryLabel: "Category",
      fieldCategoryPlaceholder: "Select category",
      fieldsSchemaLabel: sharedLabels.fieldsSchemaLabel,
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
      dependsOnLabel: "Depends on",
      dependsOnNone: "None",
      fieldHint: "Hint",
      fieldRequiredLabel: "Required",
      moveUp: "Move up",
      moveDown: "Move down",
      fieldStatusLabel: "Active",
      submitLabel: "Create Component Type",
      modeForm: sharedLabels.modeForm,
      modeJson: sharedLabels.modeJson,
      fieldNPlaceholder: sharedLabels.fieldNPlaceholder,
      switchToFormHint: sharedLabels.switchToFormHint,
      jsonErrorBadJson: "Invalid JSON:",
      jsonErrorBadShape: "Invalid schema:",
    },
    edit: {
      fieldCodeLabel: "Code",
      fieldCodeHint: sharedLabels.fieldCodeHint,
      fieldNameLabel: "Name",
      fieldCategoryLabel: "Category",
      fieldCategoryPlaceholder: "Select category",
      fieldStatusLabel: "Active",
      fieldsSchemaLabel: sharedLabels.fieldsSchemaLabel,
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
      dependsOnLabel: "Depends on",
      dependsOnNone: "None",
      fieldHint: "Hint",
      fieldRequiredLabel: "Required",
      moveUp: "Move up",
      moveDown: "Move down",
      submitLabel: "Save Changes",
      modeForm: sharedLabels.modeForm,
      modeJson: sharedLabels.modeJson,
      fieldNPlaceholder: sharedLabels.fieldNPlaceholder,
      switchToFormHint: sharedLabels.switchToFormHint,
      jsonErrorBadJson: "Invalid JSON:",
      jsonErrorBadShape: "Invalid schema:",
    },
  };

  const selectedOrg = await loadWorkspaceOrg(orgId);
  if (!selectedOrg) notFound();

  // ── Fetch component types and categories for the selected org ────────────────

  let componentTypes: ComponentTypeRow[] | null = null;
  let categories: CategoryRow[] = [];

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

  // ── Resolve selected type for edit form ────────────────────────────────────

  const selectedType = typeId && componentTypes
    ? componentTypes.find((t) => t.id === typeId) ?? null
    : null;

  // Captured as a plain const so the .map() callback below (a nested closure) narrows
  // cleanly — `componentTypes` itself is a `let`, which TS won't narrow across closures.
  const componentTypeCount = componentTypes?.length ?? 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <p className="mb-5 text-sm text-text-muted">
        Manage Component Types and their field schemas.
        Component Types are available in the Configuration step once created.
      </p>

      {/* ── Component Types section ── */}
      <div>
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
                        Order
                      </th>
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
                    {componentTypes.map((ct, index) => {
                      const isSelected = ct.id === typeId;
                      return (
                        <tr
                          key={ct.id}
                          className={isSelected ? "bg-primary-softer/30" : "hover:bg-primary-softer/20"}
                        >
                          <td className="px-5 py-4">
                            <ReorderButtons
                              orgId={orgId}
                              typeId={ct.id}
                              canMoveUp={index > 0}
                              canMoveDown={index < componentTypeCount - 1}
                            />
                          </td>
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
                                href={`/controls/orgs/${encodeURIComponent(orgId)}/components?typeId=${encodeURIComponent(ct.id)}`}
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
                  href={`/controls/orgs/${encodeURIComponent(orgId)}/components`}
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
                  initialCode={selectedType.code}
                  isCodeLocked={false}
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
    </div>
  );
}
