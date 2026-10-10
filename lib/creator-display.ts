/**
 * "Created by" display for projects and inquiries (Stage 31 S31-4).
 *
 * `createdBy` is null once the creator is deleted: the row then carries `createdByName`, a snapshot
 * of the person's name taken at delete time. Pages render a removed creator as "<name> (removed)"
 * through their own next-intl namespace; this helper only decides which case applies.
 */
export type CreatorView =
  | { removed: false; username: string; fullName: string | null }
  | { removed: true; name: string | null };

export function creatorView(
  createdBy: { username: string; name?: string | null } | null | undefined,
  createdByName: string | null | undefined,
): CreatorView {
  if (createdBy) {
    return { removed: false, username: createdBy.username, fullName: createdBy.name ?? null };
  }
  const name = createdByName?.trim();
  return { removed: true, name: name ? name : null };
}

/**
 * Ready-to-render text for a "created by" cell. `removedLabel(name)` is the page's translated
 * "<name> (removed)"; `unknownName` the translated fallback when no snapshot exists. `title` is the
 * hover text (the creator's full name when known).
 */
export function creatorCell(
  createdBy: { username: string; name?: string | null } | null | undefined,
  createdByName: string | null | undefined,
  removedLabel: (name: string) => string,
  unknownName: string,
): { text: string; title: string | undefined } {
  const v = creatorView(createdBy, createdByName);
  if (v.removed) return { text: removedLabel(v.name ?? unknownName), title: undefined };
  return { text: v.username, title: v.fullName ?? undefined };
}
