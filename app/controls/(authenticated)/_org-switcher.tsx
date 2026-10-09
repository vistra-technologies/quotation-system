"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SeatPill } from "./_seat-pill";
import { PendingOverlay } from "./users/create-user-form";

/** One row of GET /api/v1/superadmin/orgs, as the dropdown needs it. */
export interface ControlsOrg {
  id: string;
  slug: string;
  name: string;
  isSuspended: boolean;
  userCount: number;
  /** Organization.userLimit (Stage 29 Batch 2). */
  userLimit?: number | null;
}

/** Dispatched on `window` by the workspace empty state's "Choose organization" button. */
export const OPEN_ORG_SWITCHER_EVENT = "controls:open-org-switcher";

/**
 * Searchable org dropdown for the top bar (Client Component, S29-4).
 *
 * Lists every org, suspended ones included (they carry a Suspended pill). Each entry shows
 * `users/limit` — amber at the cap. Picking an org navigates to `/controls/orgs/<id>/<tab>`,
 * keeping the current tab and dropping tab-local query state such as `?typeId=` (S29-2).
 *
 * The org list is fetched once by the server layout and passed in; nothing is fetched here.
 */
export function OrgSwitcher({
  orgs,
  currentOrgId,
  currentTab,
}: {
  orgs: ControlsOrg[];
  /** Org taken from the URL, or null when no org is chosen. */
  currentOrgId: string | null;
  /** Workspace tab slug from the URL, or null outside a workspace tab. */
  currentTab: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [isPending, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const current = orgs.find((o) => o.id === currentOrgId) ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? orgs.filter((o) => `${o.name} ${o.slug}`.toLowerCase().includes(q)) : orgs;
  }, [orgs, query]);

  const openMenu = useCallback(() => {
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);

  // The workspace empty state asks the dropdown to open.
  useEffect(() => {
    window.addEventListener(OPEN_ORG_SWITCHER_EVENT, openMenu);
    return () => window.removeEventListener(OPEN_ORG_SWITCHER_EVENT, openMenu);
  }, [openMenu]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // Close on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(org: ControlsOrg) {
    setOpen(false);
    startTransition(() => {
      router.push(`/controls/orgs/${encodeURIComponent(org.id)}/${currentTab ?? "overview"}`);
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && matches[active]) {
      e.preventDefault();
      pick(matches[active]);
    }
  }

  return (
    <div ref={root} className="relative w-[340px] max-sm:static max-sm:w-auto max-sm:min-w-0 max-sm:flex-1">
      <PendingOverlay visible={isPending} />
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Organization"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="flex w-full items-center gap-2 rounded-sm border border-border-strong bg-bg-white px-3 py-2 text-left text-sm font-bold text-text-heading"
      >
        <span
          className={`min-w-0 flex-1 truncate ${current ? "" : "font-semibold text-text-placeholder"}`}
        >
          {current ? current.name : "Select organization"}
        </span>
        {current && <SeatPill used={current.userCount} limit={current.userLimit} small />}
        {current?.isSuspended && <SuspendedPill />}
        <svg
          className="h-4 w-4 shrink-0 text-text-muted"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          onKeyDown={onKeyDown}
          className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-sm border border-border-strong bg-bg-white shadow-[0_8px_24px_rgba(27,40,30,0.14)] max-sm:left-3 max-sm:right-3"
        >
          <input
            ref={input}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Search organizations"
            aria-label="Search organizations"
            autoComplete="off"
            className="w-full border-0 border-b border-border bg-bg-card px-3 py-2.5 text-sm text-text-body outline-none placeholder:text-text-placeholder"
          />
          {matches.length === 0 ? (
            <p className="px-3 py-[18px] text-center text-[13px] text-text-muted">
              No organizations match &ldquo;{query}&rdquo;
            </p>
          ) : (
            <ul role="listbox" aria-label="Organizations" className="max-h-[370px] overflow-auto">
              {matches.map((o, i) => (
                <li
                  key={o.id}
                  role="option"
                  aria-selected={o.id === currentOrgId}
                  onClick={() => pick(o)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex cursor-pointer items-center gap-2 border-b border-border px-3 py-[9px] last:border-b-0 ${
                    i === active || o.id === currentOrgId ? "bg-bg-hover" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-sm text-text-heading">{o.name}</b>
                    <i className="block font-mono text-[11px] not-italic text-text-muted">{o.slug}</i>
                  </span>
                  {o.isSuspended && <SuspendedPill />}
                  <SeatPill used={o.userCount} limit={o.userLimit} small />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SuspendedPill() {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-pill bg-status-failed-bg px-[7px] py-px text-[11px] font-bold text-status-failed-text">
      Suspended
    </span>
  );
}
