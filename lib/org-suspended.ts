/**
 * Stage 29 (S29-9) suspended-org contract, shared by the sign-in hook (lib/auth.ts), the org API
 * (lib/api-auth.ts) and the org login page.  Dependency-free on purpose (no prisma/auth imports),
 * so any of them can import it without a cycle.
 */
export const ORG_SUSPENDED_CODE = "ORG_SUSPENDED";

export const ORG_SUSPENDED_MESSAGE =
  "This organization has been suspended. Please contact your platform administrator.";
