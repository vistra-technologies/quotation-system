import type { Locator, Page } from "@playwright/test";

/**
 * Benign noise the collector ignores. Keep this list TINY and justify every entry — every other console
 * error, uncaught exception, 5xx and failed request is a real defect. Only `net::ERR_ABORTED` (the BROWSER
 * cancelled the request; the server never failed) is ever allowed, and only for these three request kinds.
 */
export const ALLOWED: { why: string; match: (problem: string) => boolean }[] = [
  {
    why: "Next.js cancels in-flight RSC fetches (<Link> prefetches, superseded router navigations) — requests carrying the `RSC: 1` header, aborted by the browser",
    match: (p) => /^request failed \[[^\]]*\/rsc\] \S+ net::ERR_ABORTED$/.test(p),
  },
  {
    why: "a document navigation superseded by a server redirect or the next navigation (e.g. /admin/users → /login → /dashboard)",
    match: (p) => /^request failed \[document\/nav\] \S+ net::ERR_ABORTED$/.test(p),
  },
  {
    why: "Vercel's preview toolbar (injected on preview deployments such as test.easeetool.com, not app code): its vercel.live / /.well-known/vercel/* calls and its OPTIONS probes of the current page URL (neither app code nor Next.js issues OPTIONS — grep), cancelled when the page navigates or closes",
    match: (p) =>
      /^request failed \[[^\]]*\] (https:\/\/vercel\.live\/|https?:\/\/[^/\s]+\/\.well-known\/vercel\/)\S* net::ERR_ABORTED$/.test(p) ||
      /^request failed \[fetch\/OPTIONS\] https?:\/\/[^/\s]+\/(?!api\/)\S* net::ERR_ABORTED$/.test(p),
  },
];

/**
 * Records every problem a page emits from now on: uncaught exceptions (a next-intl namespace missing from
 * a layout's `clientMessages` throws on hydrate — AGENTS.md), console errors (React hydration mismatches),
 * HTTP 5xx responses and failed requests. Returns a getter for the problems seen so far (minus ALLOWED).
 */
export function collectProblems(page: Page): () => string[] {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    const kind = [
      r.resourceType(),
      r.isNavigationRequest() ? "nav" : "",
      r.headers()["rsc"] === "1" ? "rsc" : "",
      r.method() === "GET" ? "" : r.method(),
    ].filter(Boolean).join("/");
    problems.push(`request failed [${kind}] ${r.url()} ${r.failure()?.errorText}`);
  });
  return () => problems.filter((p) => !ALLOWED.some((a) => a.match(p)));
}

/**
 * True once React has hydrated `el` (React attaches `__reactProps$<id>` / `__reactFiber$<id>` keys to every
 * DOM node it owns on the client). A server-rendered node whose client tree failed to hydrate — the Stage 6
 * next-intl bug class — never gets them, so "visible" alone is not enough.
 */
export async function isHydrated(el: Locator): Promise<boolean> {
  return el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$")));
}
