/**
 * When does a SuperAdmin user edit revoke the user's sessions? (Stage 31 S31-2 P5)
 *
 * Revoke on a password reset, on deactivation, and on a real reactivation (stored false -> true),
 * which kills sessions left over from a deactivation done before sessions were revoked on deactivate.
 * Never on an edit that merely re-sends `active: true` for an already-active user.
 */
export function shouldRevokeSessions(i: {
  passwordChanged: boolean;
  /** The `active` value in the edit (undefined = not part of the edit). */
  nextActive: boolean | undefined;
  /** The stored `active` value before the edit. */
  storedActive: boolean;
}): boolean {
  if (i.passwordChanged) return true;
  if (i.nextActive === false) return true;
  return i.nextActive === true && i.storedActive === false;
}
