import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
  // config is included so edit-mode can pre-fill fields (Stage 17).
  config: Record<string, string | boolean | number | null>;
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
 * Stage 17: reworked to the finalized 3-column mockup layout (ComponentType
 * sidebar / form / Saved Components list). The three columns share client-side
 * state (selected type, edit mode), so the entire block is a single Client
 * Component (AddSelectionForm). This page fetches the data and passes it down.
 *
 * Also extends the SelectionRow type to include `config` so edit-mode can
 * pre-fill field values. The DAL already returns config (all scalar fields);
 * only the TypeScript interface needed updating.
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

  // Base URL for project-relative hrefs (subdomain-aware, matching wizard layout pattern).
  const base = await orgHref(orgSlug, "");

  // Parallel fetch: project (React.cache() deduped with layout), selections,
  // component types.
  const [
    { status: projectStatus, project },
    selectionsRes,
    componentTypesRes,
  ] = await Promise.all([
    fetchProjectDetail(orgSlug, projectId),
    internalFetch(
      `/api/v1/orgs/${orgSlug}/selections?projectId=${projectId}`,
    ),
    internalFetch(`/api/v1/orgs/${orgSlug}/component-types`),
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

  // Only active ComponentTypes are offered in the picker.
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

      {activeComponentTypes.length === 0 ? (
        <div className="rounded-md border border-border bg-bg-card p-8 shadow-card text-center">
          <p className="text-sm text-text-muted">
            No active component types available. Ask an admin to configure them under Component Types.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-bg-card shadow-card">
          <AddSelectionForm
            orgSlug={orgSlug}
            projectId={projectId}
            orderIndex={selections.length}
            componentTypes={activeComponentTypes}
            selections={selections}
          />
          {/* Card footer — Back / Continue to Design (Step 3 of the wizard, 5d) */}
          <div className="flex items-center justify-between border-t border-border px-7 py-5">
            <Link
              href={`${base}/projects/${projectId}`}
              className="rounded-sm border border-border bg-bg-white px-5 py-2.5 text-sm font-bold text-text-body transition-colors hover:bg-primary-softer hover:text-text-heading"
            >
              Back
            </Link>
            <Link
              href={`${base}/projects/${projectId}/design`}
              className="rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary transition-colors hover:bg-primary-dark"
            >
              Continue to Design
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
