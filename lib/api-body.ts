import type { NextResponse } from "next/server";
import { apiBadRequest } from "@/lib/api-error";

/**
 * Request-body helpers for API route handlers (Stage 31, S31-10).
 */

/**
 * Read the request body as a JSON object. An unparseable body, `null`, an array or a primitive is a
 * 400 `"Request body must be a JSON object"` — never a 500 from a later property access.
 *
 *   const parsed = await readJsonObject(request);
 *   if (!parsed.ok) return parsed.response;
 *   const body = parsed.body;
 */
export async function readJsonObject(request: Request): Promise<JsonObjectResult> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return notAnObject();
  }
  return parseJsonObjectText(text);
}

/** Same check on body text a handler has already read (e.g. a PATCH that also accepts an empty body). */
export function parseJsonObjectText(text: string): JsonObjectResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return notAnObject();
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return notAnObject();
  return { ok: true, body: raw as Record<string, unknown> };
}

export type JsonObjectResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

function notAnObject(): { ok: false; response: NextResponse } {
  return { ok: false, response: apiBadRequest("Request body must be a JSON object") };
}

/**
 * Parse an optional "YYYY-MM-DD" date field to UTC midnight.
 *
 * - a non-string, blank or missing value -> `{ value: null }` (clears the field, as before);
 * - a string that does not form a valid date -> `{ error }` naming the field (the route answers 400).
 */
export function parseOptionalDate(
  v: unknown,
  field: string,
): { value: Date | null } | { error: string } {
  if (typeof v !== "string" || !v.trim()) return { value: null };
  const text = v.trim();
  const date = new Date(`${text}T00:00:00.000Z`);
  // The round trip rejects calendar roll-over ("2026-02-30" would silently become 2 March).
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    return { error: `${field} must be a valid date (YYYY-MM-DD)` };
  }
  return { value: date };
}
