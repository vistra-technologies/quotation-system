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
]);

export default eslintConfig;
