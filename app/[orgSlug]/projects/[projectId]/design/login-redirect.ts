/**
 * Client-side login redirect for 401/403 responses from a Client Component
 * fetch() call.
 *
 * The server-side equivalent (redirect(await orgHref(orgSlug, "/login")) —
 * used by design/actions.ts's now-removed server actions and still used by
 * add-wall/actions.ts) can't run here: orgHref()/detectIsSubdomain() read
 * next/headers(), which only works in a Server Component/action. Instead,
 * the server computes `isSubdomain` once (page.tsx, via detectIsSubdomain())
 * and forwards it as a plain boolean prop — same pattern
 * project-wizard-breadcrumb.tsx already uses for the same reason — so the
 * login href can be built without a client-side window.location.hostname
 * read (which would risk an SSR/hydration mismatch).
 */
export function loginHref(orgSlug: string, isSubdomain: boolean): string {
  return isSubdomain ? "/login" : `/${orgSlug}/login`;
}

/** Redirects the browser to the org login page. Call after a 401/403. */
export function redirectToLogin(orgSlug: string, isSubdomain: boolean): void {
  window.location.href = loginHref(orgSlug, isSubdomain);
}
