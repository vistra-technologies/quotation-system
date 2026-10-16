import { internalFetch } from "@/lib/internal-fetch";
import { isSupportedCurrency, type SupportedCurrency } from "@/lib/currency";
import { usableEstimateTypes, type ComponentTypeInput, type EstimateType } from "@/lib/quick-estimate/palette";
import { detectIsSubdomain } from "@/lib/orgHref";
import { NextIntlClientProvider } from "next-intl";
import allMessages from "@/messages/en.json";
import { EstimateProvider } from "./quick-estimate/estimate-provider";
import { TopBarActions } from "./top-bar-actions";
import { Sidebar } from "./sidebar";
import { ReloadOnLoginRedirect } from "./reload-on-login-redirect";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Org-scoped shell layout (Server Component).
 *
 * Wraps every page under /[orgSlug]/* with the Sage Ease app shell when the
 * user is authenticated. The login page passes through unchanged because
 * the /me call returns 401 there (no session cookie) and the layout renders
 * children directly.
 *
 * Stage 10 (Task 1.3): shell redesigned — sidebar extracted to <Sidebar />
 * (Client Component, owns collapse state), top bar restyled with Sage Ease
 * tokens.  The "Vistra" brand string is replaced by the EaseeTool logo mark
 * inside <Sidebar />.
 *
 * Stage 12 Batch 6: switched from getSession()/getAdminPermissions() DAL to
 * internalFetch against /api/v1/orgs/[orgSlug]/me.
 *
 * The only NextIntlClientProvider here wraps the top-bar header (the My Account popup uses
 * the `account` namespace, the Quick Estimate popup the `quickEstimate` one); it is a sibling of <main>,
 * so it never nests with the per-section layouts (projects, admin, inquiries, orders), which still
 * provide their own. `EstimateProvider` (no intl) wraps the whole shell so the top bar and the inquiry
 * pages share one Quick Estimate draft (D-22).
 *
 * Stage 33 (Quick Estimate): the component-types list is fetched in parallel with /me. The setup guard
 * (usableEstimateTypes) runs here on the server and only the trimmed usable types reach the client. A
 * failed or malformed response renders the calculator icon disabled; it never fails the shell.
 */

async function loadEstimatePalette(ctRes: Promise<Response>): Promise<{ enabled: boolean; types: EstimateType[] }> {
  try {
    const res = await ctRes;
    if (!res.ok) return { enabled: false, types: [] };
    const body = (await res.json()) as { componentTypes?: ComponentTypeInput[] };
    if (!Array.isArray(body.componentTypes)) return { enabled: false, types: [] };
    return usableEstimateTypes(body.componentTypes);
  } catch {
    return { enabled: false, types: [] };
  }
}
export default async function OrgSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  // Compute subdomain mode once on the server so Sidebar and TopBarActions
  // receive the correct value as a prop — no client-side window.location read
  // required, no SSR/hydration mismatch.
  const isSubdomain = await detectIsSubdomain(orgSlug);

  // Parallel (S33-3). The types promise gets its own catch inside loadEstimatePalette, so an early return
  // below (401/403: no chrome) leaves no unhandled rejection.
  const meResPromise = internalFetch(`/api/v1/orgs/${orgSlug}/me`);
  const typesPromise = loadEstimatePalette(internalFetch(`/api/v1/orgs/${orgSlug}/component-types`));
  const meRes = await meResPromise;

  // No session (401) or cross-org guard (403) → render page without chrome.
  // This is the pass-through for the login page and unauthenticated states.
  if (!meRes.ok) {
    return <>{children}</>;
  }

  const me = (await meRes.json()) as {
    name: string;
    username: string;
    orgName: string;
    roleName: string;
    externalCompanyName: string | null;
    adminPermissions: string[];
    firstName: string;
    lastName: string;
    mobile: string | null;
    profileEmail: string | null;
    externalCompanyCurrency: string | null;
  };
  const estimate = await typesPromise;
  const estimateCurrency: SupportedCurrency | null = isSupportedCurrency(me.externalCompanyCurrency)
    ? me.externalCompanyCurrency
    : null;

  const canManageUsers = me.adminPermissions.includes("MANAGE_USERS");
  // Stage 20 Batch 3: canManageFeatures reintroduced — gates the "Catalog" flyout link
  // (org-admin value-list editor). Component Type shape/CRUD itself is still SuperAdmin-only
  // at /controls/component-types (Stage 19 Batch 5); unaffected by this.
  const canManageFeatures = me.adminPermissions.includes("MANAGE_FEATURES");
  // Bugfix 2026-09-28: gates the "Inventory" flyout link (moved under /admin/inventory by
  // Hotfix 2026-09-27 H-1, which is MANAGE_PRICING-gated) — a Company Member (MANAGE_PRICING
  // only, no MANAGE_USERS) previously couldn't even see the Admin flyout, let alone the
  // Inventory link inside it. See inventory-gate-fix.md.
  const canManagePricing = me.adminPermissions.includes("MANAGE_PRICING");

  return (
    <EstimateProvider
      orgSlug={orgSlug}
      orgName={me.orgName}
      enabled={estimate.enabled}
      types={estimate.types}
      defaultCurrency={estimateCurrency ?? "INR"}
    >
    <div className="flex h-screen bg-bg-page">
      {/* Hard-reloads if a client-side nav lands on /login (revoked/expired session),
          so the stale shell doesn't stay around the login form. */}
      <ReloadOnLoginRedirect />
      {/* Sidebar — Client Component owning collapse state */}
      <Sidebar
        orgSlug={orgSlug}
        isSubdomain={isSubdomain}
        canManageUsers={canManageUsers}
        canManageFeatures={canManageFeatures}
        canManagePricing={canManagePricing}
      />

      {/* Right column: top bar + page content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        {/* D4 Stage 15: org/company chips moved from left to right corner, inside TopBarActions */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-end border-b border-border bg-bg-card px-10 shadow-header">
          {/* Home + Profile actions — right side (chips now included inside) */}
          <NextIntlClientProvider messages={{ account: allMessages.account, quickEstimate: allMessages.quickEstimate }}>
            <TopBarActions
              orgSlug={orgSlug}
              isSubdomain={isSubdomain}
              name={me.name}
              username={me.username}
              roleName={me.roleName}
              orgName={me.orgName}
              externalCompanyName={me.externalCompanyName}
              firstName={me.firstName}
              lastName={me.lastName}
              mobile={me.mobile}
              profileEmail={me.profileEmail}
            />
          </NextIntlClientProvider>
        </header>

        {/* Main content area */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
    </EstimateProvider>
  );
}
