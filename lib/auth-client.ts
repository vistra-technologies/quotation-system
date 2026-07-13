"use client";

import { createAuthClient } from "better-auth/react";

/**
 * better-auth React client for use in Client Components (e.g. the login form,
 * logout button).
 *
 * No explicit baseURL: the default is "/api/auth" (relative to the current
 * origin).  All orgs share the same host under path-based routing, so relative
 * URLs ensure auth requests always go to the same origin where the cookie is set.
 */
export const authClient = createAuthClient();
