import { apiBadRequest, apiForbidden } from "@/lib/api-error";
import { createRateCap, MAX_BODY_BYTES, parseClientErrorReport } from "@/lib/client-errors";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";
import { NextResponse } from "next/server";

// Never cached.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/client-errors ──────────────────────────────────────────────
//
// Stage 30 (S30-10). Ingest for the two client crash boundaries (app/global-error.tsx,
// app/[orgSlug]/admin/error.tsx). Unauthenticated by design (OPEN-7: global-error can fire on the
// login page or with a broken session), no DB. The limits ARE the abuse control:
//   content-length > 2048 -> 413 (the body is read capped at 2 KB regardless of the header)
//   Origin present and not our own host -> 403
//   not a JSON object with exactly the allowed keys/ranges -> 400
//   > 60 accepted reports/min per instance -> 429 (best effort)
//   success -> 204 and one `client.error` log line (host, no user id; the raw body is never logged).

const cap = createRateCap();

function tooLarge(): NextResponse {
  return NextResponse.json({ error: "Payload too large" }, { status: 413 });
}

/** Reads at most MAX_BODY_BYTES; returns null when the body is larger. */
async function readCapped(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const POST = withRoute("POST /api/v1/client-errors", async (request: Request): Promise<Response> => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // unparseable Origin (including "null") never matches
    }
    if (originHost !== host) return apiForbidden();
  }

  const text = await readCapped(request);
  if (text === null) return tooLarge();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return apiBadRequest("Invalid report");
  }
  const report = parseClientErrorReport(parsed);
  if (!report) return apiBadRequest("Invalid report");

  if (!cap.tryAccept()) return NextResponse.json({ error: "Too many reports" }, { status: 429 });

  log.error("client.error", {
    boundary: report.boundary,
    message: report.message,
    digest: report.digest,
    path: report.path,
    host,
  });
  return new Response(null, { status: 204 });
});
