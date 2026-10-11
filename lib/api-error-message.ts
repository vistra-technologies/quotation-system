/**
 * Client-safe error text from an API failure body (Stage 32, S32-1/S32-2).
 *
 * NO imports on purpose: this is used by "use server" action files and client components, and must
 * not pull in lib/api-error.ts (next/server, node:async_hooks).
 *
 * The message is `body.error` when that is a non-empty string, else `fallback`. When the body also
 * carries a well-formed `requestId` (only apiServerError(), i.e. a 5xx, produces one) the text ends
 * with " (Reference: <requestId>)". 4xx bodies have no requestId, so they never show a reference.
 * "Reference" is hard-coded English: /controls has no NextIntlClientProvider.
 */
const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function apiErrorMessage(body: unknown, fallback: string): string {
  const o = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  const message = o && typeof o.error === "string" && o.error.length > 0 ? o.error : fallback;
  const id = o?.requestId;
  return typeof id === "string" && REQUEST_ID.test(id) ? `${message} (Reference: ${id})` : message;
}
