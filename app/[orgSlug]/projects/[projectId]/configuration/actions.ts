"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// ---------------------------------------------------------------------------
// createSelection
// ---------------------------------------------------------------------------

export type CreateSelectionState = { error: string | null };

/**
 * Create a new Selection on a project.
 *
 * Moved verbatim from [projectId]/actions.ts (Stage 9 URL restructure).
 * Only change in Stage 9: revalidatePath and redirect targets updated to the
 * /configuration path so submitting stays on Step 2 (Configuration).
 *
 * Stage 12: thin marshaler — parses FormData, delegates to
 * POST /api/v1/orgs/[orgSlug]/selections via internalFetch.
 * All tenancy enforcement and business logic live in the route handler.
 *
 * Uses the useActionState signature so the client form can surface errors
 * (e.g. tenancy violations on malformed payloads) rather than crashing to an
 * error boundary.
 */
export async function createSelection(
  prevState: CreateSelectionState,
  formData: FormData,
): Promise<CreateSelectionState> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";

  const projectId = (formData.get("projectId") as string | null)?.trim();
  const componentTypeId = (
    formData.get("componentTypeId") as string | null
  )?.trim();
  const label = (formData.get("label") as string | null)?.trim();
  const configStr = (formData.get("config") as string | null) || "{}";
  const orderIndex = parseInt(
    (formData.get("orderIndex") as string | null) || "0",
    10,
  );

  if (!projectId || !componentTypeId || !label) {
    return { error: "Project, component type, and label are required." };
  }

  let config: Record<string, string | boolean | number | null>;
  try {
    config = JSON.parse(configStr) as Record<
      string,
      string | boolean | number | null
    >;
  } catch {
    return { error: "Invalid configuration data." };
  }

  const res = await internalFetch(`/api/v1/orgs/${orgSlug}/selections`, {
    method: "POST",
    body: JSON.stringify({
      projectId,
      componentTypeId,
      label,
      config,
      orderIndex: isNaN(orderIndex) ? 0 : orderIndex,
    }),
  });

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!res.ok) {
    let errorMessage = "An unexpected error occurred — please try again.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // ignore JSON parse failure
    }
    return { error: errorMessage };
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}/configuration`);
  redirect(
    await orgHref(orgSlug, `/projects/${projectId}/configuration`),
    RedirectType.replace,
  );
}
