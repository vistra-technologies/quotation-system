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
      {/* Selections list */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {tSelections("sectionTitle")}
        </h2>
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {selections.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {tSelections("noSelections")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                    <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">#</th>
                    <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                      {tSelections("fieldLabel")}
                    </th>
                    <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                      {tSelections("stepPickType")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selections.map((sel, i) => (
                    <tr
                      key={sel.id}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                    >
                      <td className="px-5 py-3 text-zinc-500 dark:text-zinc-400">{i + 1}</td>
                      <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-50">
                        {sel.label}
                      </td>
                      <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">
                        {sel.componentType.name}
                      </td>
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
        <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {tSelections("addComponent")}
        </h2>
        {activeComponentTypes.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No active component types available. Ask an admin to configure them under Component Types.
          </p>
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
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
