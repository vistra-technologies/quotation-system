import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Subdomain-aware URL helpers
// ---------------------------------------------------------------------------
// When PLAYWRIGHT_BASE_URL points at test.easeetool.com (or any *.easeetool.com
// host), proxy.ts intentionally 404s every non-root path on the apex domain —
// path-based org URLs like /{orgSlug}/login don't reach the app.  Only subdomain
// URLs ({orgSlug}.test.easeetool.com/...) work on that host.
//
// When PLAYWRIGHT_BASE_URL is a Vercel preview URL (*.vercel.app) or localhost,
// proxy.ts falls back to path-segment extraction — relative URLs work fine.
//
// These helpers pick the right form at module load time so spec files don't need
// per-test branching.

const _BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

function _isSubdomainHost(): boolean {
  try {
    const h = new URL(_BASE_URL).hostname;
    return h === "easeetool.com" || h.endsWith(".easeetool.com");
  } catch {
    return false;
  }
}

/** True when the suite is running against an *.easeetool.com host. */
export const isSubdomain: boolean = _isSubdomainHost();

/**
 * Build an org-scoped page URL for page.goto(), compatible with both routing
 * modes:
 *   Path mode (Vercel preview / localhost): "/{orgSlug}{path}"
 *   Subdomain mode (*.easeetool.com):       "https://{orgSlug}.{apex}{path}"
 */
export function orgUrl(orgSlug: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (isSubdomain) {
    const base = new URL(_BASE_URL);
    return `${base.protocol}//${orgSlug}.${base.hostname}${p}`;
  }
  return `/${orgSlug}${p}`;
}

/**
 * Build an API URL for page.request calls, compatible with both routing modes.
 *
 * Unlike orgUrl(), this does NOT prepend /{orgSlug} in path mode — API routes
 * live at /api/v1/... (not /{orgSlug}/api/v1/...).  In subdomain mode it
 * returns an absolute URL pointing at {orgSlug}.{apex} so the request avoids
 * the apex domain (which 404s all non-root paths).
 *
 *   Path mode: returns apiPath as-is (relative; Playwright resolves via baseURL)
 *   Subdomain mode: returns "https://{orgSlug}.{apex}{apiPath}" (absolute)
 */
export function apiUrl(orgSlug: string, apiPath: string): string {
  const p = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  if (isSubdomain) {
    const base = new URL(_BASE_URL);
    return `${base.protocol}//${orgSlug}.${base.hostname}${p}`;
  }
  return p;
}

/**
 * Build a RegExp that matches an org-scoped URL in both routing modes, for use
 * with page.waitForURL(), expect(page).toHaveURL(), and string .toMatch().
 *
 * pathPattern must start with "/" and may include regex metacharacters
 * (e.g., "/inquiries/[0-9a-f-]{36}$").
 *
 * Pattern: `{orgSlug}(?:[./][^/]+)?{pathPattern}`
 *   Path mode:     …/{orgSlug}{pathPattern}
 *   Subdomain mode: …{orgSlug}.{host}{pathPattern}
 *
 * Verified:
 *   - In path mode the optional group first tries to match the separator + next
 *     segment (greedily consuming pathPattern chars), then backtracks and skips
 *     the group so pathPattern can match at the separator position.
 *   - In subdomain mode the optional group matches ".{host}", after which
 *     pathPattern matches the literal path.
 *   - "$"-anchored and UUID-pattern pathPatterns work correctly in both modes.
 */
export function orgUrlPattern(orgSlug: string, pathPattern: string): RegExp {
  return new RegExp(`${orgSlug}(?:[./][^/]+)?${pathPattern}`);
}

/**
 * Sign in as a specific user for a given org.
 *
 * Reads the password from the TEST_ADMIN_PASSWORD env var when username is
 * "admin" (so the test suite keeps working if the admin password is rotated
 * without editing source), then falls back to the seeded default.
 *
 * Extracted from pricing-stage3.spec.ts:38-54 so Stage 4+ specs can share it.
 *
 * Stage 10 (Task 1.4): login page rebuilt to match login-page.html mockup.
 * The username field label changed from "Username" to "User ID" (matching the
 * mockup's <label for="userId">User ID</label>).  The heading guard was
 * replaced with an input visibility check (more robust post-rebuild).
 */
/**
 * Fill the Stage 14 required fields shared by both the inquiry create form
 * and the project create form (identical field names on both).
 *
 * Stage 14 Batch B/C added 8 required end-client fields, made `currency` a
 * `<select>`, made `projectLocation` required, and removed `destinationCountry`
 * entirely.  All specs that submit either form must call this helper (or
 * equivalent inline fills) after filling the `name` field.
 *
 * `submissionDate` has a `defaultValue={todayLocal}` pre-fill — no fill needed.
 *
 * @param currency  INR | AED | USD — defaults to "AED"
 * @param projectLocation  String shown on the detail page — defaults to "Dubai, UAE"
 */
export async function fillCreateFormRequiredFields(
  page: Page,
  currency: "INR" | "AED" | "USD" = "AED",
  projectLocation = "Dubai, UAE",
) {
  await page.locator("select[name='currency']").selectOption(currency);
  await page.locator("input[name='projectLocation']").fill(projectLocation);
  await page.locator("input[name='endClientName']").fill("E2E Client");
  await page.locator("input[name='endClientPhone']").fill("+971501234567");
  await page.locator("input[name='endClientEmail']").fill("e2e@test.com");
  // GST Number is conditionally required when the linked company is India (D20).
  // Always fill it so the helper works regardless of the company's country in the
  // live dev DB. The field accepts any text; it is optional when isIndia=false.
  await page.locator("input[name='endClientGstNumber']").fill("29AAACC1206H1ZY");
  await page.locator("input[name='endClientAddressLine1']").fill("123 Test St");
  await page.locator("input[name='endClientAddressLine2']").fill("Test Area");
  await page.locator("input[name='endClientCity']").fill("Dubai");
  await page.locator("input[name='endClientState']").fill("Dubai");
}

export async function signIn(
  page: Page,
  username: string,
  password = process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!",
  orgSlug = "acme-glass",
) {
  await page.goto(orgUrl(orgSlug, "/login"));
  // Wait for the login form to be ready (user-id input rendered) before
  // filling credentials.  The input's autocomplete="username" attribute is
  // the stable anchor regardless of label text.
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 30_000,
  });

  // Submit and intercept the sign-in API response to detect rate-limiting (429).
  //
  // Root cause of the ~1-in-15 flake on full-suite runs (confirmed):
  //   - better-auth rate limit: 3 sign-ins per 10 s per IP, stored in-memory per
  //     Vercel serverless instance (enabled=isProduction, storage="memory" default,
  //     no RateLimit model in schema → no DB storage configured).
  //   - fullyParallel:true → 8 workers can all sign in at startup, clustering
  //     3+ requests on the same warm Vercel instance → 429 cascade.
  //   - stage6.spec.ts:379 is the same flake manifesting in the Selection round-trip
  //     test; no separate fix is needed — the signIn helper fix covers both.
  //
  // Fix: targeted retry only on 429 (not a blanket retry).
  //   - 4 attempts (3 retries) handles worst-case 8-worker cluster: workers 1-3
  //     succeed, workers 4-8 get 429 → retry → workers 4-6 succeed, 7-8 get 429
  //     → retry again → both succeed.
  //   - Uses X-Retry-After response header (seconds until window expires) + 1 s
  //     buffer for the wait, rather than a fixed 10 s, so it stays accurate if the
  //     better-auth window config ever changes.
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.getByLabel("User ID").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);

    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes("/api/auth/sign-in"),
        { timeout: 15_000 },
      ),
      page.getByRole("button", { name: /Sign in/i }).click(),
    ]);

    if (response.status() !== 429) break;

    // Rate-limited: wait until better-auth's window expires before retrying.
    // X-Retry-After header (set by rateLimitResponse()) is seconds remaining;
    // +1 s buffer ensures we're past the strict `now - lastRequest > windowInMs`
    // boundary check in decideConsume().
    if (attempt < 4) {
      const retryAfterSec = Number(response.headers()["x-retry-after"] ?? "10");
      await page.waitForTimeout((retryAfterSec + 1) * 1_000);
    }
  }

  await page.waitForURL(orgUrlPattern(orgSlug, "/dashboard"), { timeout: 30_000 });
}
