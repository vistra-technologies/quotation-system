"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const isLoginPath = (p: string) => /\/login\/?$/.test(p);

/**
 * Rendered inside the org layout's authenticated branch only (hotfix
 * 2026-10-02, stale-shell-on-logout).
 *
 * When a tab's session is revoked/expired, the next client-side navigation is
 * redirected to /login — but Next.js keeps this shared layout mounted across
 * client navigations, so the sidebar and top bar drawn for the old session stay
 * around the login form. A hard reload re-runs the layout, whose /me check now
 * 401s and renders the page bare.
 *
 * Only a *transition* into /login reloads. Loading /login directly while signed
 * in has no transition, so this cannot loop; and after the reload the layout no
 * longer renders this component at all.
 */
export function ReloadOnLoginRedirect() {
  const pathname = usePathname();
  const previous = useRef(pathname);

  useEffect(() => {
    const was = previous.current;
    previous.current = pathname;
    if (was !== pathname && isLoginPath(pathname) && !isLoginPath(was)) {
      window.location.replace(window.location.href);
    }
  }, [pathname]);

  return null;
}
