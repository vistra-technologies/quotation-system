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
