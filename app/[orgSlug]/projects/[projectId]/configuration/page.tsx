import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { parseFieldsSchema, parseFieldOptionsConfig } from "@/lib/parse-field-config";
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
  // Stage 20: SuperAdmin-authored wiring (key of an earlier field this field depends on).
  dependsOn?: string;
}

/**
 * Shape of a single ComponentType as offered to the form/sidebar.
 *
 * Populated from one of two sources (Stage 22 B5):
 *   - `project.configSnapshot.componentTypes` (normal path) — no `category` (Decision #6's
 *     snapshot shape doesn't carry it; confirmed unused below, D-11).
 *   - GET /api/v1/.../component-types (null-guard fallback only) — includes `category`.
 * Neither add-selection-form.tsx nor this page ever reads `.category`, so it stays optional
 * rather than forcing every snapshot row to fabricate one.
 */
interface ComponentTypeRow {
  id: string;
  name: string;
  code: string;
  active: boolean;
  category?: { id: string; name: string };
  fieldsSchema: FieldEntry[];
  // Stage 20 Batch 4: org-level dropdown/radio value config. null = the org hasn't configured
  // any field on this type yet (live path); the snapshot path always supplies `{}` for the same
  // case (Stage 22 B4) — both are treated identically by the gating helpers (`?? {}`).
  fieldOptionsConfig: FieldOptionsConfig | null;
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

  // Parallel fetch: project (React.cache() deduped with layout) + selections.
  // component-types is fetched below, conditionally — only on the null-guard
  // path — so a snapshot render never issues a ComponentType/OrgConfig query.
  const [{ status: projectStatus, project }, selectionsRes] = await Promise.all([
    fetchProjectDetail(orgSlug, projectId),
    internalFetch(`/api/v1/orgs/${orgSlug}/selections?projectId=${projectId}`),
  ]);

  // Auth redirect on 401 or 403 from either call so far.
  if (
    projectStatus === 401 ||
    projectStatus === 403 ||
    selectionsRes.status === 401 ||
    selectionsRes.status === 403
  ) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  // Tenancy guard: project not found or belongs to a different org.
  if (!project) notFound();

  // No step-gate on Configuration itself — this is the page where you ADD
  // Selections, so it must be reachable from the start (via the Project Details
  // "Next: Configuration →" button). The breadcrumb shows it as locked until
  // selectionCount > 0, but the page itself is always accessible. (Stage 19 Batch 4)

  const selections: SelectionRow[] = selectionsRes.ok
    ? ((await selectionsRes.json()) as { selections: SelectionRow[] }).selections
    : [];

  // Stage 22 B5 — component options come from the project's frozen configSnapshot when
  // present; a project created before this stage (or in the pre-backfill window) has
  // `configSnapshot: null`, so we fall back to today's live read.
  const usingSnapshot = project.configSnapshot !== null;

  let allComponentTypes: ComponentTypeRow[];
  if (usingSnapshot) {
    // Snapshot's fieldsSchema/fieldOptionsConfig are stored raw (Stage 22 B4) — parse them
    // through the same helpers the live route uses so the form/gating logic sees identical
    // typed shapes regardless of source.
    allComponentTypes = project.configSnapshot!.componentTypes.map((ct) => ({
      id: ct.id,
      name: ct.name,
      code: ct.code,
      active: ct.active,
      fieldsSchema: parseFieldsSchema(ct.fieldsSchema),
      fieldOptionsConfig: parseFieldOptionsConfig(ct.fieldOptionsConfig),
    }));
  } else {
    // null-guard: snapshot absent (pre-backfill window) — reading live config
    const componentTypesRes = await internalFetch(
      `/api/v1/orgs/${orgSlug}/component-types`,
    );
    if (componentTypesRes.status === 401 || componentTypesRes.status === 403) {
      redirect(await orgHref(orgSlug, "/login"));
    }
    allComponentTypes = componentTypesRes.ok
      ? (
          (await componentTypesRes.json()) as {
            componentTypes: ComponentTypeRow[];
          }
        ).componentTypes
      : [];
  }

  // Only active ComponentTypes are offered in the picker.
  const activeComponentTypes = allComponentTypes.filter((ct) => ct.active);

  // Page heading removed — its copy now shows as a hover tooltip on the
  // "Configuration" pill in the wizard breadcrumb (project-wizard-breadcrumb.tsx),
  // matching Design, which never had an on-page heading either.
  return (
    // R-1: flex-1 min-h-0 propagates the bounded height from WizardPageShell
    // down into the card so the grid columns can scroll independently instead
    // of pushing the whole page taller than the viewport.
    <div className="flex flex-1 flex-col py-8">
      {activeComponentTypes.length === 0 ? (
        <div className="rounded-md border border-border bg-bg-card p-8 shadow-card text-center">
          <p className="text-sm text-text-muted">
            No active component types available. Ask an admin to configure them under Component Types.
          </p>
        </div>
      ) : (
        // R-1: card is now a flex column so the grid (flex-1) fills available
        // space and the footer (shrink-0) stays pinned at the bottom.
        <div className="flex flex-1 flex-col rounded-md border border-border bg-bg-card shadow-card">
          <AddSelectionForm
            orgSlug={orgSlug}
            projectId={projectId}
            orderIndex={selections.length}
            componentTypes={activeComponentTypes}
            selections={selections}
            snapshotNotice={usingSnapshot}
          />
          {/* Card footer — Back / Continue to Design (Step 3 of the wizard, 5d) */}
          <div className="flex shrink-0 items-center justify-between border-t border-border px-7 py-5">
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
