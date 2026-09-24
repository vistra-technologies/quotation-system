"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";

// ─── State types ──────────────────────────────────────────────────────────────

/**
 * State returned by formula-set server actions for use with `useActionState`.
 * `validationErrors` is present when the API returns 400 with a Validation-failed body.
 */
export type FormulaSetFormState = {
  error: string | null;
  validationErrors?: string[];
};

// ─── Server actions ───────────────────────────────────────────────────────────

/**
 * Create a new FormulaSet via the SuperAdmin API route.
 * Reads name and bodyJson from FormData.
 * On success: revalidates the list page and redirects to the new set's detail page.
 * On 401: redirects to /controls/login.
 * On any other error (400 validation, 409 race): returns { error, validationErrors? }
 * so the create form can display it inline.
 *
 * Stage 25 Batch 4 — Formula Sets SuperAdmin screens.
 */
export async function createSuperAdminFormulaSet(
  prevState: FormulaSetFormState,
  formData: FormData,
): Promise<FormulaSetFormState> {
  const name = (formData.get("name") as string | null)?.trim();
  const bodyJson = (formData.get("bodyJson") as string | null)?.trim();

  if (!name) return { error: "Name is required" };
  if (!bodyJson) return { error: "Formula Set Body is required" };

  // Parse the JSON body — the API expects an object, not a string.
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyJson);
  } catch {
    return { error: "Invalid JSON — please check the body syntax" };
  }

  if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
    return { error: "Formula Set Body must be a JSON object (not an array or primitive)" };
  }

  const res = await internalFetch("/api/v1/superadmin/formula-sets", {
    method: "POST",
    body: JSON.stringify({ name, body: parsedBody }),
  });

  if (res.status === 401) redirect("/controls/login");

  if (!res.ok) {
    const responseBody = (await res.json()) as {
      error?: string;
      validationErrors?: string[];
    };
    if (responseBody.validationErrors && responseBody.validationErrors.length > 0) {
      return {
        error: responseBody.error ?? "Validation failed",
        validationErrors: responseBody.validationErrors,
      };
    }
    return { error: responseBody.error ?? "Failed to create formula set" };
  }

  const { formulaSet } = (await res.json()) as { formulaSet: { id: string } };

  revalidatePath("/controls/formula-sets");
  redirect(`/controls/formula-sets/${encodeURIComponent(formulaSet.id)}`, RedirectType.replace);
}

/**
 * Update an existing FormulaSet via the SuperAdmin API route.
 * Reads setId, name, and bodyJson from FormData.
 * On success: revalidates and redirects back to the detail page.
 * On 401: redirects to /controls/login.
 * On 409 (locked) or 400 (validation): returns { error, validationErrors? } for inline display.
 *
 * Stage 25 Batch 4 — Formula Sets SuperAdmin screens.
 */
export async function updateSuperAdminFormulaSet(
  prevState: FormulaSetFormState,
  formData: FormData,
): Promise<FormulaSetFormState> {
  const setId = formData.get("setId") as string | null;
  const name = (formData.get("name") as string | null)?.trim();
  const bodyJson = (formData.get("bodyJson") as string | null)?.trim();

  if (!setId) return { error: "setId is required" };
  if (!name) return { error: "Name is required" };
  if (!bodyJson) return { error: "Formula Set Body is required" };

  // Parse the JSON body.
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyJson);
  } catch {
    return { error: "Invalid JSON — please check the body syntax" };
  }

  if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
    return { error: "Formula Set Body must be a JSON object (not an array or primitive)" };
  }

  const res = await internalFetch(
    `/api/v1/superadmin/formula-sets/${encodeURIComponent(setId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name, body: parsedBody }),
    },
  );

  if (res.status === 401) redirect("/controls/login");

  if (!res.ok) {
    const responseBody = (await res.json()) as {
      error?: string;
      validationErrors?: string[];
    };
    if (responseBody.validationErrors && responseBody.validationErrors.length > 0) {
      return {
        error: responseBody.error ?? "Validation failed",
        validationErrors: responseBody.validationErrors,
      };
    }
    return { error: responseBody.error ?? "Failed to update formula set" };
  }

  revalidatePath("/controls/formula-sets");
  revalidatePath(`/controls/formula-sets/${setId}`);
  redirect(`/controls/formula-sets/${encodeURIComponent(setId)}`, RedirectType.replace);
}
