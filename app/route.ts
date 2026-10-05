import { readFileSync } from "node:fs";
import path from "node:path";

// Apex landing page (Stage 28, S28-16): the signed-off standalone mockup, served as-is.
// Static — rendered once at build time, no DB or API call. A page and a route handler cannot
// share "/", so this replaces app/page.tsx. Org subdomains never reach it: proxy.ts rewrites
// their "/" to /{orgSlug}, which is handled by app/[orgSlug]/.
export const dynamic = "force-static";

const html = readFileSync(
  path.join(process.cwd(), "content", "landing", "home.html"),
  "utf-8",
);

export function GET() {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
