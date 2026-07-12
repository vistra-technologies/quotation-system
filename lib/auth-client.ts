"use client";

import { createAuthClient } from "better-auth/react";

/**
 * better-auth React client for use in Client Components (e.g. the login form,
 * logout button).
 *
 * No explicit baseURL: the default is "/api/auth" (relative to the current
 * origin).  Since each org lives on its own subdomain (acme-glass.localhost:3000),
 * relative URLs ensure auth requests go to the same host where the cookie will
 * be set — giving host-only per-org session isolation without crossSubDomainCookies.
 */
export const authClient = createAuthClient();
