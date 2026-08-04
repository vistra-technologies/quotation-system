import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vercel CLI build output (generated; not source)
    ".vercel/**",
    // Playwright test artifacts (generated; not source)
    "playwright-report/**",
    "test-results/**",
  ]),
  // Ban direct prisma imports under app/ — all DB access must go through
  // lib/data/*.ts so tenancy checks and org-scoping are enforced in one place.
  {
    files: ["app/**/*.ts", "app/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "@/lib/prisma",
          message: "Import prisma only from lib/data/*.ts — direct app/ imports bypass tenancy checks.",
        }],
      }],
    },
  },
  // Ban direct lib/data/* imports from org-scoped pages and actions.
  // Stage 12 layer separation: all DB access from app/[orgSlug]/** must go through
  // internalFetch → API route handler → DAL. API routes (app/api/**) are exempt.
  // Deferred files (design/*, design/add-wall/*) use eslint-disable with a note per stage-12.md.
  {
    files: ["app/\\[orgSlug\\]/**/*.ts", "app/\\[orgSlug\\]/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@/lib/data/*"],
          message: "Org-scoped pages/actions must not import lib/data/* — use internalFetch against API routes instead (Stage 12 layer separation). Deferred files may use eslint-disable with a note per stage-12.md.",
        }],
      }],
    },
  },
]);

export default eslintConfig;
