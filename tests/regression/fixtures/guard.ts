export class GuardError extends Error {
  constructor(message: string) { super(message); this.name = "GuardError"; }
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const SA_PREFIX = "/api/v1/superadmin/";

function refuse(method: string, pathname: string, why: string): never {
  throw new GuardError(`refusing ${method} ${pathname}: ${why}`);
}

function effectiveOrgId(parsed: URL, body: unknown, method: string, pathname: string): string | null {
  const q = parsed.searchParams.get("orgId");
  const b = (body as { orgId?: unknown } | null | undefined)?.orgId;
  const fromBody = typeof b === "string" && b !== "" ? b : null;
  const fromQuery = q !== null && q !== "" ? q : null;
  if (fromBody !== null && fromQuery !== null && fromBody !== fromQuery) {
    refuse(method, pathname, `body orgId "${fromBody}" differs from query orgId "${fromQuery}"`);
  }
  return fromBody ?? fromQuery;
}

/**
 * Throws BEFORE the request is sent when a mutating call targets anything outside the suite's own
 * orgs / rows. `url` may be absolute or a path. Only GET/HEAD/OPTIONS are never blocked; any other
 * method (odd verbs, trailing spaces, ...) is treated as mutating (fail closed).
 * `allowedIds` = ids of rows this run created (orgs, formula sets, admins, ...), checked for
 * id-addressed SuperAdmin mutations. `body` is the JSON body: roles / component-types routes
 * carry `orgId` there (or in the query for DELETE).
 */
export function assertMutationAllowed(
  method: string,
  url: string,
  allowedOrgSlugs: ReadonlySet<string>,
  allowedIds: ReadonlySet<string> = new Set(),
  body?: unknown,
): void {
  if (SAFE.has(method.toUpperCase())) return;
  if (url.startsWith("//") || url.includes("\\")) refuse(method, url, "ambiguous URL");
  const parsed = new URL(url, "http://guard.invalid");
  const pathname = parsed.pathname;
  if (pathname.includes("%") || pathname.includes("//")) {
    refuse(method, pathname, "encoded or empty path segments are not allowed");
  }

  const org = /^\/api\/v1\/orgs\/([^/]+)(?:\/|$)/.exec(pathname);
  if (org) {
    if (!allowedOrgSlugs.has(org[1])) {
      refuse(method, pathname, `org "${org[1]}" is not the Test Org / this run's throwaway org`);
    }
    return;
  }

  if (pathname.startsWith(SA_PREFIX)) {
    const seg = pathname.slice(SA_PREFIX.length).split("/");
    if (seg.some((s) => s === "")) refuse(method, pathname, "empty path segment");
    const [head, id, sub, sub2] = seg;
    const idOk = (v: string | undefined) => v !== undefined && allowedIds.has(v);

    if ((head === "login" || head === "logout") && seg.length === 1) return;
    if (head === "admins") {
      if (seg.length === 1) return; // create our own throwaway admin
      if (seg.length === 2 && idOk(id)) return;
      refuse(method, pathname, `admin "${id}" was not created by this run (or unknown shape)`);
    }
    if (head === "orgs") {
      if (seg.length === 1) return; // create
      const shapeOk =
        seg.length === 2 ||
        (seg.length === 3 && (sub === "suspend" || sub === "users")) ||
        (seg.length === 4 && sub === "users" && sub2 !== undefined);
      if (shapeOk && idOk(id)) return;
      refuse(method, pathname, `org id "${id}" was not created by this run (or unknown shape)`);
    }
    if (head === "roles" || head === "component-types") {
      const orgId = effectiveOrgId(parsed, body, method, pathname);
      if (orgId !== null && allowedIds.has(orgId)) return;
      refuse(method, pathname, `${head} mutations require an orgId (body or query) created by this run`);
    }
    if (head === "formula-sets") {
      if (seg.length === 1) return; // create a new row
      if ((seg.length === 2 || (seg.length === 3 && sub === "version")) && idOk(id)) return;
      refuse(method, pathname, `formula set "${id}" was not created by this run (or unknown shape)`);
    }
    refuse(method, pathname, "not an allowed SuperAdmin mutation shape");
  }

  if (pathname === "/api/v1/client-errors") return; // Stage 30: log-only ingest, no DB write, no org data
  if (pathname.startsWith("/api/auth/")) return; // sign-in/out
  refuse(method, pathname, "unknown mutation target");
}
