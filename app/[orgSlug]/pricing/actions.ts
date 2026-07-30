"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

/**
 * Upsert (add or update) an ItemPrice for a specific CatalogItem + currency.
 *
 * Stage 12: thin marshaler — parses FormData, delegates to
 * POST /api/v1/orgs/[orgSlug]/catalog/[itemId]/prices via internalFetch.
 * All tenancy enforcement and RBAC live in the route handler.
 *
 * On 401/403: redirect to login.
 * On other non-2xx: throw (surfaces to Next.js error boundary — same behavior
 * as the pre-migration action which also threw on validation/RBAC failures).
 * On success: revalidate the item detail path and redirect back to it.
 */
export async function upsertItemPrice(formData: FormData): Promise<void> {
  const orgSlug = (formData.get("orgSlug") as string | null) ?? "";
  const itemId = (formData.get("itemId") as string | null)?.trim();
  const currency = (formData.get("currency") as string | null)?.trim().toUpperCase();
  const priceRaw = formData.get("price") as string | null;

  if (!itemId || !currency || !priceRaw) {
    throw new Error("Invalid form data: itemId, currency, and price are required");
  }

  const price = parseFloat(priceRaw);
  if (isNaN(price) || price < 0) {
    throw new Error("Invalid price value");
  }

  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/catalog/${itemId}/prices`,
    {
      method: "POST",
      body: JSON.stringify({ currency, price }),
    },
  );

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
    throw new Error(errorMessage);
  }

  revalidatePath(`/${orgSlug}/pricing/${itemId}`);
  redirect(
    await orgHref(orgSlug, `/pricing/${itemId}`),
    RedirectType.replace,
  );
}

/**
 * Delete a single ItemPrice row.
 *
 * Stage 12: thin marshaler — delegates to
 * DELETE /api/v1/orgs/[orgSlug]/catalog/[itemId]/prices (body: { priceId })
 * via internalFetch. All tenancy enforcement and RBAC live in the route handler.
 *
 * Signature updated from (itemPriceId, orgSlug) to (itemPriceId, itemId, orgSlug)
 * to allow constructing the API URL (which includes [itemId] as a path segment).
 * The inline closure in pricing/[itemId]/page.tsx is updated to pass item.id.
 *
 * On 401/403: redirect to login.
 * On other non-2xx: throw (error boundary).
 * On success: revalidate list + item detail paths, redirect back to item detail.
 */
export async function deleteItemPrice(
  itemPriceId: string,
  itemId: string,
  orgSlug: string,
): Promise<void> {
  const res = await internalFetch(
    `/api/v1/orgs/${orgSlug}/catalog/${itemId}/prices`,
    {
      method: "DELETE",
      body: JSON.stringify({ priceId: itemPriceId }),
    },
  );

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
    throw new Error(errorMessage);
  }

  revalidatePath(`/${orgSlug}/pricing`);
  revalidatePath(`/${orgSlug}/pricing/${itemId}`);
  redirect(
    await orgHref(orgSlug, `/pricing/${itemId}`),
    RedirectType.replace,
  );
}
