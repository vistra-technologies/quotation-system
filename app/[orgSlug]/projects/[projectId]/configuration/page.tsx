import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/data/session";
import { getProjectById } from "@/lib/data/projects";
import { listSelections } from "@/lib/data/selections";
import { listComponentTypes } from "@/lib/data/components";
import { AddSelectionForm } from "./add-selection-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

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
 * Auth gate: requireSession only — no special permission required.
 */
export default async function ConfigurationPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const session = await requireSession(orgSlug);

  const [project, selections, allComponentTypes, tSelections] = await Promise.all([
    getProjectById(session, projectId),
    listSelections(session, projectId),
    listComponentTypes(session),
    getTranslations("selections"),
  ]);

  // Tenancy guard: project not found or belongs to a different org.
  if (!project) notFound();

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
