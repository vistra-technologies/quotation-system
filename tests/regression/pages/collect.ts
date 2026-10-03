import type { Locator, Page } from "@playwright/test";
import { TEST_ORG } from "../env";

/**
 * The hosts the page specs load pages from: PLAYWRIGHT_BASE_URL's host (apex / path mode) and the Test
 * Org's subdomain of it (subdomain mode). Read at call time so unit tests can set the env first.
 */
export function suiteHosts(): string[] {
  const base = process.env.PLAYWRIGHT_BASE_URL;
  if (!base) return [];
  const host = new URL(base).hostname.toLowerCase();
  return [host, `${TEST_ORG}.${host}`];
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};
const onSuiteHost = (url: string): boolean => suiteHosts().includes(hostOf(url) ?? "");

/** "request failed [kind] url errorText" → its parts (null for any other problem string). */
function parseFailure(p: string): { kind: string; url: string; error: string } | null {
  const m = /^request failed \[([^\]]*)\] (\S+) (\S+)$/.exec(p);
  return m ? { kind: m[1], url: m[2], error: m[3] } : null;
}

/**
 * Benign noise the collector ignores. Keep this list TINY and justify every entry — every other console
 * error, uncaught exception, 5xx and failed request is a real defect. Only `net::ERR_ABORTED` (the BROWSER
 * cancelled the request; the server never failed) is ever allowed, and only for these three request kinds.
 */
export const ALLOWED: { why: string; match: (problem: string) => boolean }[] = [
  {
    why: "Next.js cancels in-flight RSC GETs (<Link> prefetches, superseded router navigations) — requests carrying the `RSC: 1` header, aborted by the browser (a server action is tagged …/rsc/POST and is NOT allowed)",
    match: (p) => {
      const f = parseFailure(p);
      return !!f && f.error === "net::ERR_ABORTED" && /(^|\/)rsc$/.test(f.kind);
    },
  },
  {
    why: "a document navigation superseded by a server redirect or the next navigation (e.g. /admin/users → /login → /dashboard)",
    match: (p) => {
      const f = parseFailure(p);
      return !!f && f.error === "net::ERR_ABORTED" && f.kind === "document/nav";
    },
  },
  {
    why:
      "Vercel's preview toolbar (injected on preview deployments such as test.easeetool.com, not app code): its vercel.live calls, " +
      "its /.well-known/vercel/* calls and its OPTIONS probes of the current page URL on the suite's own hosts (neither app code nor " +
      "Next.js issues OPTIONS — grep), cancelled when the page navigates or closes",
    match: (p) => {
      const f = parseFailure(p);
      if (!f || f.error !== "net::ERR_ABORTED") return false;
      const u = new URL(f.url);
      if (u.protocol === "https:" && u.hostname === "vercel.live") return true;
      if (!onSuiteHost(f.url)) return false;
      if (u.pathname.startsWith("/.well-known/vercel/")) return true;
      return f.kind === "fetch/OPTIONS" && !u.pathname.startsWith("/api/");
    },
  },
];

/**
 * Records every problem a page emits from now on: uncaught exceptions (a next-intl namespace missing from
 * a layout's `clientMessages` throws on hydrate — AGENTS.md; the shared LoadingOverlay mounted under
 * /controls throws the same way), console errors (React hydration mismatches), HTTP 5xx responses and
 * failed requests. Returns a getter for the problems seen so far (minus ALLOWED).
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
 * Same-origin requests (on the suite's hosts) that have started but not yet finished or failed. A test
 * reads the collector only once this is empty, so closing the context can never abort an unseen call.
 */
export function trackInFlight(page: Page): () => string[] {
  const pending = new Set<import("@playwright/test").Request>();
  page.on("request", (r) => {
    // A new main-frame DOCUMENT navigation discards the previous document; its unfinished requests die with it
    // and Chromium does not always report them as failed — stop tracking them.
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) pending.clear();
    // Vercel preview-toolbar traffic (allow-list entry 3) is not the app's and may stay open; not tracked.
    if (r.method() === "OPTIONS" || new URL(r.url()).pathname.startsWith("/.well-known/vercel/")) return;
    // Next.js <Link> prefetches (`Next-Router-Prefetch: 1`) are speculative, not the page's own calls; a
    // superseded one is cancelled without Chromium always reporting it, so it would never "finish". Their
    // failures are still collected (allow-list entry 1 only forgives ERR_ABORTED).
    if (r.headers()["next-router-prefetch"] === "1") return;
    if (onSuiteHost(r.url())) pending.add(r);
  });
  const done = (r: import("@playwright/test").Request) => pending.delete(r);
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return () => [...pending].map((r) => `${r.method()} ${r.url()}`);
}

/**
 * True once React has hydrated `el` (React attaches `__reactProps$<id>` / `__reactFiber$<id>` keys to every
 * DOM node it owns on the client). A server-rendered node whose client tree failed to hydrate — the Stage 6
 * next-intl bug class — never gets them, so "visible" alone is not enough.
 */
export async function isHydrated(el: Locator): Promise<boolean> {
  return el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$")));
}
