import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/prisma";

/**
 * better-auth server instance.
 *
 * Authentication strategy: emailAndPassword with a synthetic email key.
 * The `email` field below stores `{username}@{orgSlug}.internal` — NOT a
 * real user email.  See lib/auth-utils.ts → toAuthEmail().
 *
 * D1 guardrail: keep requireEmailVerification: false, enable NO better-auth
 * email plugin, and do NOT send email from this instance.
 * // TODO: if enabling email features, migrate email field first
 *
 * Real user email lives only in the `profileEmail` additionalField.
 */
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",

  // Synthetic-email field is NOT a real email — block all email flows.
  // TODO: if enabling email features, migrate email field first
  emailAndPassword: {
    enabled: true,
    // Users are provisioned server-side only (Vistra staff, no public self-serve signup).
    // Without this flag the /api/auth/sign-up/email route is publicly live and accepts
    // arbitrary additionalFields, allowing anyone to self-provision a user into any org/role.
    disableSignUp: true,
    requireEmailVerification: false,
  },

  // 30-day sliding session: refresh daily.
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days in seconds
    updateAge: 60 * 60 * 24, // refresh session token once per day
  },

  // Use the Prisma 7 singleton from lib/prisma.ts.
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  advanced: {
    // Distinct cookie prefix so qs-* cookies don't collide with other tools.
    // No crossSubDomainCookies — cookies are host-only by default; each
    // subdomain gets its own session.
    cookiePrefix: "qs",
  },

  // Declare domain additionalFields so better-auth saves/returns them
  // alongside the standard user fields.
  user: {
    additionalFields: {
      organizationId: {
        type: "string",
        required: true,
        returned: true,
      },
      username: {
        type: "string",
        required: true,
        returned: true,
      },
      active: {
        type: "boolean",
        required: false,
        defaultValue: true,
        returned: true,
      },
      roleId: {
        type: "string",
        required: true,
        returned: true,
      },
      externalCompanyId: {
        type: "string",
        required: false,
        returned: true,
      },
      profileEmail: {
        type: "string",
        required: false,
        returned: true,
      },
    },
  },

  plugins: [
    // Handles RSC / Server-Action cookie lifecycle in Next.js App Router.
    nextCookies(),
  ],
});

export type Auth = typeof auth;
