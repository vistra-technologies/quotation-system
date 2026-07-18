"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSelection as dalCreateSelection } from "@/lib/data/selections";
import { requireSession } from "@/lib/data/session";

// ---------------------------------------------------------------------------
// createSelection
// ---------------------------------------------------------------------------

export type CreateSelectionState = { error: string | null };

/**
 * Create a new Selection on a project.
 *
 * Uses the useActionState signature so the client form can surface errors
 * (e.g. tenancy violations on malformed payloads) rather than crashing to an
 * error boundary. All DB work and tenancy is delegated to lib/data/selections.ts.
 */
export async function createSelection(
  prevState: CreateSelectionState,
  formData: FormData,
): Promise<CreateSelectionState> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const session = await requireSession(orgSlug ?? "");

  const projectId = (formData.get("projectId") as string | null)?.trim();
  const componentTypeId = (formData.get("componentTypeId") as string | null)?.trim();
  const label = (formData.get("label") as string | null)?.trim();
  const configStr = (formData.get("config") as string | null) || "{}";
  const orderIndex = parseInt((formData.get("orderIndex") as string | null) || "0", 10);

  if (!projectId || !componentTypeId || !label) {
    return { error: "Project, component type, and label are required." };
  }

  let config: Record<string, string | boolean | number | null>;
  try {
    config = JSON.parse(configStr) as Record<string, string | boolean | number | null>;
  } catch {
    return { error: "Invalid configuration data." };
  }

  try {
    await dalCreateSelection(session, {
      projectId,
      componentTypeId,
      label,
      config,
      orderIndex,
    });
  } catch (err) {
    if (err instanceof Error) {
      return { error: err.message };
    }
    throw err;
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  redirect(`/${orgSlug}/projects/${projectId}`);
}
