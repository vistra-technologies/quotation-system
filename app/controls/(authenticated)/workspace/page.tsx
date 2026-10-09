/**
 * Org workspace with no org chosen: the empty state (Stage 29 S29-2 / S29-4).
 *
 * The org dropdown lives in the top bar (controls-shell.tsx); this page only points at it.
 * Static markup: the dropdown's open state is the shell's, so the button dispatches a DOM event
 * the switcher listens for (see _org-switcher.tsx OPEN_ORG_SWITCHER_EVENT).
 */
import { ChooseOrgButton } from "./_choose-org-button";

export default function WorkspaceEmptyPage() {
  return (
    <div className="rounded-md border border-border bg-bg-card px-6 py-14 text-center shadow-card">
      <div className="mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-full bg-primary-softer text-primary-dark">
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
      </div>
      <h1 className="text-lg font-bold text-text-heading">No organization selected</h1>
      <p className="mx-auto mb-[18px] mt-1.5 max-w-[420px] text-sm text-text-muted">
        Pick an organization from the dropdown in the top bar to manage its overview, users, roles,
        components and formula set.
      </p>
      <ChooseOrgButton />
    </div>
  );
}
