export class GuardError extends Error {
  constructor(message: string) { super(message); this.name = "GuardError"; }
}

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const SA_PREFIX = "/api/v1/superadmin/";

function refuse(method: string, pathname: string, why: string): never {
  throw new GuardError(`refusing ${method} ${pathname}: ${why}`);
}

/**
 * Throws BEFORE the request is sent when a mutating call targets anything outside the suite's own
 * orgs / rows. `url` may be absolute or a path. Reads (GET/HEAD) are never blocked.
 * `allowedIds` = ids of rows this run created (orgs, formula sets, ...), checked for id-addressed
 * SuperAdmin mutations.
 */
export function assertMutationAllowed(
  method: string,
  url: string,
  allowedOrgSlugs: ReadonlySet<string>,
  allowedIds: ReadonlySet<string> = new Set(),
): void {
  if (!MUTATING.has(method.toUpperCase())) return;
  const parsed = new URL(url, "http://guard.invalid");
  const pathname = parsed.pathname;

  const org = /^\/api\/v1\/orgs\/([^/]+)/.exec(pathname);
  if (org) {
    if (!allowedOrgSlugs.has(org[1])) {
      refuse(method, pathname, `org "${org[1]}" is not the Test Org / this run's throwaway org`);
    }
    return;
  }

  if (pathname.startsWith(SA_PREFIX)) {
    const seg = pathname.slice(SA_PREFIX.length).replace(/\/+$/, "").split("/");
    const [head, id, sub, sub2] = seg;
    const idOk = (v: string | undefined) => v !== undefined && allowedIds.has(v);

    if ((head === "login" || head === "logout") && seg.length === 1) return;
    if (head === "admins" && seg.length <= 2) return; // our own throwaway admins
    if (head === "orgs") {
      if (seg.length === 1) return; // create
      const shapeOk =
        seg.length === 2 ||
        (seg.length === 3 && (sub === "suspend" || sub === "users")) ||
        (seg.length === 4 && sub === "users" && sub2 !== undefined);
      if (shapeOk && idOk(id)) return;
      refuse(method, pathname, `org id "${id}" was not created by this run`);
    }
    if (head === "roles" || head === "component-types") {
      const orgId = parsed.searchParams.get("orgId");
      if (orgId !== null && allowedIds.has(orgId)) return;
      refuse(method, pathname, `${head} mutations require ?orgId=<id created by this run>`);
    }
    if (head === "formula-sets") {
      if (seg.length === 1) return; // create a new row
      if ((seg.length === 2 || (seg.length === 3 && sub === "version")) && idOk(id)) return;
      refuse(method, pathname, `formula set "${id}" was not created by this run`);
    }
    refuse(method, pathname, "not an allowed SuperAdmin mutation shape");
  }

  if (pathname.startsWith("/api/auth/")) return; // sign-in/out
  refuse(method, pathname, "unknown mutation target");
}
