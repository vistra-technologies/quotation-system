/**
 * Derives the globally-unique synthetic email that better-auth uses as its
 * primary key for this user.  The value is `{username}@{orgSlug}.internal`.
 *
 * D1 guardrail: EVERY call site that needs this key MUST import this function.
 * Never write the `${username}@${orgSlug}.internal` template inline anywhere.
 *
 * The synthetic email satisfies zod's `.email()` validator (valid format) and
 * is globally unique across orgs because orgSlug is globally unique.  The
 * per-org uniqueness guarantee is separately enforced by the
 * @@unique([organizationId, username]) constraint on the User table.
 */
export function toAuthEmail(username: string, orgSlug: string): string {
  return `${username}@${orgSlug}.internal`;
}

/**
 * Derives the platform-level synthetic email for a SuperAdmin account.
 * The value is `{username}@platform.internal`.
 *
 * D1 guardrail: EVERY call site building a SuperAdmin auth email MUST use this.
 * Never write the `${username}@platform.internal` template inline anywhere.
 *
 * "platform" is a reserved slug (see RESERVED_ORG_SLUGS) — this email shape
 * is globally distinct from any org user's synthetic email.
 */
export function toPlatformAuthEmail(username: string): string {
  return `${username}@platform.internal`;
}

/**
 * Reserved org slugs that may never be registered as real organization slugs.
 *
 * "platform" is reserved because `{username}@platform.internal` is the email
 * shape used for SuperAdmin accounts — allowing "platform" as an org slug would
 * create a collision in the synthetic-email namespace.
 *
 * Enforced at: org-create API (validate), seed (skip-guard).
 */
export const RESERVED_ORG_SLUGS: readonly string[] = ["platform"] as const;
