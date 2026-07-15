import { betterAuth, APIError } from "better-auth";
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

  // Allow browser requests from preview deployments in addition to the
  // canonical baseURL origin (which covers production and localhost).
  //
  // Two preview origins must be trusted:
  //   1. The raw per-deploy URL — Vercel auto-injects VERCEL_URL on every
  //      build (no manual config needed); absent on local dev.
  //   2. The stable QA alias https://v-quote-test.vercel.app — manually
  //      re-pointed to the latest preview build after each deploy.
  //
  // trustedOrigins is a top-level BetterAuthOptions field (string[] |
  // async-function). Strings are matched via matchesOriginPattern(); wildcard
  // patterns like "https://*.vercel.app" are supported but deliberately
  // avoided here — exact origins are tighter and correct for our two cases.
  trustedOrigins: [
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
    "https://v-quote-test.vercel.app",
  ],

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
    // No crossSubDomainCookies — cookies are host-only by default; all org paths
    // share the same cookie jar on the single deployed host.
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

  // Reject sign-in for deactivated users at the auth layer (defense-in-depth).
  // The page-level guard in lib/session.ts also rejects them, but this hook
  // ensures no valid session token is ever issued for an inactive account,
  // even for callers that bypass getSession().
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { active: true },
          });
          if (user?.active === false) {
            throw new APIError("UNAUTHORIZED", {
              message: "Account is deactivated.",
              code: "ACCOUNT_DEACTIVATED",
            });
          }
        },
      },
    },
  },
});

export type Auth = typeof auth;
