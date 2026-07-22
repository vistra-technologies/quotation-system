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

  // Allow browser requests from preview deployments and production subdomains
  // in addition to the canonical baseURL origin (which covers localhost).
  //
  // Origins trusted:
  //   1. The raw per-deploy Vercel URL — auto-injected as VERCEL_URL on every
  //      build (no manual config needed); absent on local dev.
  //   2. The stable QA alias https://v-quote-test.vercel.app — manually
  //      re-pointed to the latest preview build after each deploy.
  //      Keep this entry until staging migrates to an easeetool.com subdomain.
  //   3. All org subdomains — wildcard pattern supported natively by
  //      better-auth 1.6.23 via matchesOriginPattern().
  //
  // trustedOrigins is a top-level BetterAuthOptions field (string[] | async-function).
  trustedOrigins: [
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
    "https://v-quote-test.vercel.app", // staging alias; remove once staging migrates to easeetool.com
    "https://*.easeetool.com", // all org subdomains (Stage 10 subdomain routing)
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
    cookiePrefix: "qs",
    // Share the session cookie across all *.easeetool.com subdomains (Stage 10
    // subdomain routing).  Each org lives on its own subdomain; without this the
    // browser treats acme-glass.easeetool.com and vistra.easeetool.com as
    // independent cookie jars and cannot share a single-signon session.
    //
    // `enabled` is conditional: when BETTER_AUTH_URL does NOT target easeetool.com
    // (localhost dev, *.vercel.app ad-hoc preview), the Domain attribute is omitted
    // entirely — browsers would reject a ".easeetool.com" Domain on those hosts
    // (RFC 6265 §5.3 host-match failure) and drop the session cookie silently.
    crossSubDomainCookies: {
      enabled: (process.env.BETTER_AUTH_URL ?? "").includes("easeetool.com"),
      domain: ".easeetool.com",
    },
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
