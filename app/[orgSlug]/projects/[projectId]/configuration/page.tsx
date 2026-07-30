import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { fetchProjectDetail } from "../_project-fetch";
import { AddSelectionForm } from "./add-selection-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── API response types ──────────────────────────────────────────────────────

/** Shape of a single Selection as returned by GET /api/v1/.../selections */
interface SelectionRow {
  id: string;
  label: string;
  orderIndex: number;
  componentType: { id: string; name: string; code: string };
}

/**
 * Shape of a single FieldEntry within a ComponentType's fieldsSchema.
 * Must match FieldEntry in lib/data/components.ts (duplicated to avoid bundling
 * server-only DAL code — same pattern as add-selection-form.tsx).
 */
interface FieldEntry {
  key: string;
  label: string;
  type: "field" | "radio" | "dropdown" | "checkbox";
  options?: string[];
  hint?: string;
  required: boolean;
  basic: boolean;
}

/** Shape of a single ComponentType as returned by GET /api/v1/.../component-types */
interface ComponentTypeRow {
  id: string;
  name: string;
  code: string;
  active: boolean;
  category: { id: string; name: string };
  fieldsSchema: FieldEntry[];
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Configuration page — Step 2 of the project wizard (Server Component).
 *
 * Moved verbatim from [projectId]/page.tsx (Stage 9 URL restructure).
 * Shows the Selections list and the "Add component" form.
 *
 * Stage 10 (Task 1.7): restyled to Sage Ease tokens — page heading, card
 * wrappers, table header/body, empty state, form wrapper. Parity-critical:
 * all data fetching, server actions, validation logic, and form IDs are
 * unchanged.
 *
 * Stage 12: switched from direct requireSession + DAL calls to internalFetch
 * against the new API routes. Project fetch reuses the React.cache()-wrapped
 * fetchProjectDetail helper shared with the layout and project-detail page —
 * no duplicate HTTP round-trip for the project data. Selections and component
 * types are fetched in parallel via internalFetch.
 *
 * Auth gate: API routes return 401/403 on unauthenticated/cross-tenant requests;
 * the page redirects to login on 401/403. 404 → notFound().
 */
export default async function ConfigurationPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;

  // Parallel fetch: project (React.cache() deduped with layout), selections,
  // component types, and translations.
  const [
    { status: projectStatus, project },
    selectionsRes,
    componentTypesRes,
    tSelections,
  ] = await Promise.all([
    fetchProjectDetail(orgSlug, projectId),
    internalFetch(
      `/api/v1/orgs/${orgSlug}/selections?projectId=${projectId}`,
    ),
    internalFetch(`/api/v1/orgs/${orgSlug}/component-types`),
    getTranslations("selections"),
  ]);

  // Auth redirect on 401 or 403 from any of the three API calls.
  if (
    projectStatus === 401 ||
    projectStatus === 403 ||
    selectionsRes.status === 401 ||
    selectionsRes.status === 403 ||
    componentTypesRes.status === 401 ||
    componentTypesRes.status === 403
  ) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  // Tenancy guard: project not found or belongs to a different org.
  if (!project) notFound();

  const selections: SelectionRow[] = selectionsRes.ok
    ? ((await selectionsRes.json()) as { selections: SelectionRow[] }).selections
    : [];

  const allComponentTypes: ComponentTypeRow[] = componentTypesRes.ok
    ? (
        (await componentTypesRes.json()) as {
          componentTypes: ComponentTypeRow[];
        }
      ).componentTypes
    : [];

  // Only active ComponentTypes are offered in the "Add component" picker.
  const activeComponentTypes = allComponentTypes.filter((ct) => ct.active);

  return (
    <div>
      {/* Page heading */}
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold text-text-heading">Configuration</h1>
        <p className="mt-1 text-sm text-text-muted">
          Add and configure the components for this project
        </p>
      </div>

      {/* Selections list */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-base font-extrabold text-text-heading before:h-4 before:w-1 before:rounded-sm before:bg-primary before:content-['']">
          {tSelections("sectionTitle")}
        </h2>

        <div className="rounded-md border border-border bg-bg-card shadow-card">
          {selections.length === 0 ? (
            /* Empty state — dashed border box */
            <div className="m-5 rounded-md border border-dashed border-border px-6 py-10 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[10px] bg-primary-softer text-primary">
                {/* Box / package icon */}
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
                </svg>
              </div>
              <p className="text-sm font-bold text-text-heading">
                {tSelections("noSelections")}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Use the form below to add your first component.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                      #
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                      {tSelections("fieldLabel")}
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                      {tSelections("stepPickType")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selections.map((sel, i) => (
                    <tr
                      key={sel.id}
                      className="border-b border-border last:border-0 hover:bg-primary-softer/40"
                    >
                      <td className="px-5 py-4 text-text-muted">{i + 1}</td>
                      <td className="px-5 py-4 font-bold text-text-heading">{sel.label}</td>
                      <td className="px-5 py-4 text-text-body">{sel.componentType.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Add component section */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-base font-extrabold text-text-heading before:h-4 before:w-1 before:rounded-sm before:bg-primary before:content-['']">
          {tSelections("addComponent")}
        </h2>

        {activeComponentTypes.length === 0 ? (
          <p className="text-sm text-text-muted">
            No active component types available. Ask an admin to configure them under Component Types.
          </p>
        ) : (
          <div className="rounded-md border border-border bg-bg-card p-6 shadow-card">
            <AddSelectionForm
              orgSlug={orgSlug}
              projectId={projectId}
              orderIndex={selections.length}
              componentTypes={activeComponentTypes}
            />
          </div>
        )}
      </section>
    </div>
  );
}
