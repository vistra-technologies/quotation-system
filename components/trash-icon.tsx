/**
 * Shared solid-fill trash glyph — replaces the heavier outline/emoji trash
 * icons that read as "disabled" at rest (Stage 21 QA: bugs 1 and 8). Used
 * everywhere a delete affordance appears (Configuration's Saved Components
 * rows, the Design page's floor row) so the icon is visually consistent.
 */
export function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M9 3a1 1 0 0 0-1 1v1H4v2h16V5h-4V4a1 1 0 0 0-1-1H9zm-3 6 1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12H6z" />
    </svg>
  );
}
