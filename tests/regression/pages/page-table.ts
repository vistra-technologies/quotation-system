/**
 * The page table (Task 12): one row per `app/**\/page.tsx`, keyed by the path coverage-map.ts prints.
 * pages.spec.ts generates the access + render tests from it, and its "table is complete" test proves the
 * rows, the spec's literal coversPage() lines and the app's pages are the same set.
 *
 * Access facts were read from the page/layout source AND observed live on test.easeetool.com; where they
 * differ, the observed behaviour is the contract (see pages.spec.ts header).
 */
import type { PermissionCode } from "../api/permissions";

export type ParamKey = "projectId" | "inquiryId" | "companyId" | "userId" | "setId" | "orgId";

export type Access =
  /** No session needed; the anonymous visit IS the authorised render. */
  | "public"
  /** Any member of the org (every Test-Org role). */
  | "org"
  /** Org members holding this permission; the others are redirected to /dashboard. */
  | { permission: PermissionCode }
  /** SuperAdmin console (qs-sa-token session). */
  | "sa";

export interface PageRow {
  /** The app route, exactly as coverage-map.ts prints it (route groups stripped). */
  path: string;
  access: Access;
  /** Visible on the authorised render (and, for denial checks, must NOT be visible). */
  expectsText: RegExp;
  /**
   * Redirect-only entries: where the visit lands, by identity kind, when it is not the page itself.
   * `anon` / `signedIn` are paths relative to the org (org pages) or the apex (/controls, /).
   */
  landsOn?: { anon?: string; signedIn?: string; signedInText?: RegExp };
  /** The page's primary control: must be visible, enabled and React-hydrated (next-intl failure class). */
  primary?: { role: "button" | "link"; name: RegExp };
  /** The project the page is rendered for: a submitted wall (design → summary → quotation all open). */
  project?: true;
}

/** The authorised-render text of the org login form (anonymous visit). */
export const ORG_LOGIN_TEXT = /Sign in to continue to your account/;
/** The cross-org notice an org-B session gets on a Test-Org login page (it names org B only). */
export const CROSS_ORG_TEXT = /You're already signed in/;
export const SA_LOGIN_TEXT = /Sign in with your SuperAdmin credentials/;
export const DASHBOARD_TEXT = /Welcome, RGR /;

export const PAGES: PageRow[] = [
  // ── apex / public ─────────────────────────────────────────────────────────
  { path: "/", access: "public", expectsText: /Select your organization/ },
  { path: "/organizations", access: "public", expectsText: /Fetched live from Postgres via Prisma/ },

  // ── org entry pages ───────────────────────────────────────────────────────
  { path: "/[orgSlug]", access: "public", expectsText: ORG_LOGIN_TEXT, landsOn: { anon: "/login", signedIn: "/dashboard", signedInText: DASHBOARD_TEXT } },
  { path: "/[orgSlug]/login", access: "public", expectsText: ORG_LOGIN_TEXT, landsOn: { signedIn: "/dashboard", signedInText: DASHBOARD_TEXT } },

  // ── org pages, any member ─────────────────────────────────────────────────
  { path: "/[orgSlug]/dashboard", access: "org", expectsText: DASHBOARD_TEXT },
  { path: "/[orgSlug]/inquiries", access: "org", expectsText: /Manage your organization's inquiries/, primary: { role: "link", name: /^New Inquiry$/ } },
  { path: "/[orgSlug]/inquiries/new", access: "org", expectsText: /New Inquiry/, primary: { role: "button", name: /^Create Inquiry$/ } },
  { path: "/[orgSlug]/inquiries/[inquiryId]", access: "org", expectsText: /rgr-.*-inq-/ },
  { path: "/[orgSlug]/inquiries/[inquiryId]/edit", access: "org", expectsText: /Edit Inquiry/, primary: { role: "button", name: /Save Changes/ } },
  { path: "/[orgSlug]/orders", access: "org", expectsText: /Manage your organization's orders/ },
  { path: "/[orgSlug]/projects", access: "org", expectsText: /Manage your organization's projects/, primary: { role: "link", name: /^New Project$/ } },
  { path: "/[orgSlug]/projects/new", access: "org", expectsText: /New Project/, primary: { role: "button", name: /^Create$/ } },
  { path: "/[orgSlug]/projects/[projectId]", access: "org", project: true, expectsText: /Project Information/, primary: { role: "button", name: /^Delete project$/ } },
  { path: "/[orgSlug]/projects/[projectId]/configuration", access: "org", project: true, expectsText: /Component options were captured when this project was created/, primary: { role: "button", name: /^Add Component$/ } },
  { path: "/[orgSlug]/projects/[projectId]/design", access: "org", project: true, expectsText: /Wall Details/, primary: { role: "button", name: /^Submit Design$/ } },
  { path: "/[orgSlug]/projects/[projectId]/edit", access: "org", project: true, expectsText: /Edit Project/, primary: { role: "button", name: /^Save Changes$/ } },
  { path: "/[orgSlug]/projects/[projectId]/summary", access: "org", project: true, expectsText: /Export PDF/, primary: { role: "button", name: /^Recompute$/ } },
  { path: "/[orgSlug]/projects/[projectId]/quotation", access: "org", project: true, expectsText: /Coming Soon/ },
  // The suite's own GLASS rename window (projects.spec.ts) can make a config update available for a moment.
  { path: "/[orgSlug]/projects/[projectId]/update-configuration", access: "org", project: true, expectsText: /Configuration is already up to date|Formula/ },

  // ── org admin pages ───────────────────────────────────────────────────────
  { path: "/[orgSlug]/admin/catalog", access: { permission: "MANAGE_FEATURES" }, expectsText: /Catalog/ },
  { path: "/[orgSlug]/admin/inventory", access: { permission: "MANAGE_PRICING" }, expectsText: /Inventory Management/ },
  { path: "/[orgSlug]/admin/users", access: { permission: "MANAGE_USERS" }, expectsText: /User Management/ },
  { path: "/[orgSlug]/admin/users/new", access: { permission: "MANAGE_USERS" }, expectsText: /Create User/ },
  { path: "/[orgSlug]/admin/users/[userId]", access: { permission: "MANAGE_USERS" }, expectsText: /User Detail/ },
  { path: "/[orgSlug]/admin/external-companies", access: { permission: "MANAGE_USERS" }, expectsText: /External Companies/ },
  { path: "/[orgSlug]/admin/external-companies/new", access: { permission: "MANAGE_USERS" }, expectsText: /Create External Company/ },
  { path: "/[orgSlug]/admin/external-companies/[companyId]", access: { permission: "MANAGE_USERS" }, expectsText: /Edit External Company/ },

  // ── SuperAdmin console ────────────────────────────────────────────────────
  { path: "/controls", access: "public", expectsText: SA_LOGIN_TEXT, landsOn: { anon: "/controls/login", signedIn: "/controls/orgs", signedInText: /Organizations/ } },
  { path: "/controls/login", access: "public", expectsText: SA_LOGIN_TEXT, landsOn: { signedIn: "/controls/orgs", signedInText: /Organizations/ } },
  { path: "/controls/orgs", access: "sa", expectsText: /Organizations/ },
  { path: "/controls/orgs/new", access: "sa", expectsText: /Create organization/ },
  { path: "/controls/orgs/[orgId]", access: "sa", expectsText: /Edit — RGR / },
  { path: "/controls/roles", access: "sa", expectsText: /Roles & Permissions/ },
  { path: "/controls/users", access: "sa", expectsText: /Users/ },
  { path: "/controls/component-types", access: "sa", expectsText: /Component Types/ },
  { path: "/controls/formula-sets", access: "sa", expectsText: /All Formula Sets/ },
  { path: "/controls/formula-sets/[setId]", access: "sa", expectsText: /glass-partition-standard/ },
  { path: "/controls/formula-sets/[setId]/new-version", access: "sa", expectsText: /glass-partition-standard/ },
  { path: "/controls/audit-log", access: "sa", expectsText: /Audit log/ },
];

/** Substitute `[param]` segments. */
export function fillPath(path: string, params: Partial<Record<ParamKey, string>>): string {
  return path.replace(/\[(\w+)\]/g, (m, k: string) => {
    const v = params[k as ParamKey];
    if (!v) throw new Error(`page-table: no value for ${m} in ${path}`);
    return v;
  });
}

export const isOrgPage = (row: PageRow): boolean => row.path.startsWith("/[orgSlug]");
/** "/[orgSlug]/x/y" → "/x/y" ("/[orgSlug]" → "/"). */
export const orgRelative = (path: string): string => path.replace(/^\/\[orgSlug\]/, "") || "/";
