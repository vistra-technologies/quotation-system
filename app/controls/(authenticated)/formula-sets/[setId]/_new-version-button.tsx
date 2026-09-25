import Link from "next/link";

interface NewVersionButtonProps {
  setId: string;
}

/**
 * "Create new version" link for a locked FormulaSet.
 *
 * Hotfix 2026-09-25 (H-4): no longer creates a row on click. It opens the
 * new-version draft page, pre-filled from this set; the N+1 row is only
 * written when the draft is saved there. Shown on locked sets only —
 * unlocked sets use the edit form instead.
 *
 * Stage 25 Batch 4 — Formula Sets SuperAdmin screens.
 */
export function NewVersionButton({ setId }: NewVersionButtonProps) {
  return (
    <Link
      href={`/controls/formula-sets/${encodeURIComponent(setId)}/new-version`}
      className="inline-flex items-center rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
    >
      + Create new version
    </Link>
  );
}
