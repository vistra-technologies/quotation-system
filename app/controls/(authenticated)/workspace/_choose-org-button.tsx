"use client";

import { OPEN_ORG_SWITCHER_EVENT } from "../_org-switcher";

/** "Choose organization": opens the top-bar org dropdown. */
export function ChooseOrgButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_ORG_SWITCHER_EVENT))}
      className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
    >
      Choose organization
    </button>
  );
}
