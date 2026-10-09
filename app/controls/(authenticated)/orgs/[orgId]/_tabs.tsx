"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SeatPill } from "../../_seat-pill";

const TABS = [
  { slug: "overview", label: "Overview" },
  { slug: "users", label: "Users" },
  { slug: "roles", label: "Roles & Permissions" },
  { slug: "components", label: "Components" },
  { slug: "formula", label: "Formula & Pricing" },
] as const;

/** Tab slugs, exported for the shell's org switcher (keeps the current tab on org change). */
export const TAB_SLUGS: readonly string[] = TABS.map((t) => t.slug);

/**
 * Workspace tab strip (Client Component, S29-2 / S29-5).
 *
 * The URL is the source of truth: the active tab is the pathname's last segment under
 * /controls/orgs/[orgId]. The strip scrolls horizontally on phones and the active tab is
 * centred in it (mockup review M-2).
 */
export function OrgTabs({
  orgId,
  userCount,
  userLimit,
}: {
  orgId: string;
  userCount: number;
  userLimit?: number | null;
}) {
  const pathname = usePathname();
  const base = `/controls/orgs/${encodeURIComponent(orgId)}`;
  const active = TABS.find((t) => pathname === `${base}/${t.slug}`)?.slug ?? "overview";
  const strip = useRef<HTMLElement>(null);

  // Centre the active tab. Re-run after the sidebar width transition (200 ms) has settled.
  useEffect(() => {
    const center = () => {
      const el = strip.current;
      const at = el?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!el || !at) return;
      const r = at.getBoundingClientRect();
      const br = el.getBoundingClientRect();
      el.scrollLeft += r.left + r.width / 2 - (br.left + br.width / 2);
    };
    center();
    const t = setTimeout(center, 260);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <nav
      ref={strip}
      aria-label="Organization workspace tabs"
      className="mb-6 mt-4 flex gap-0.5 overflow-x-auto whitespace-nowrap border-b border-border"
    >
      {TABS.map((t) => {
        const on = t.slug === active;
        return (
          <Link
            key={t.slug}
            href={`${base}/${t.slug}`}
            aria-current={on ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-[3px] px-4 py-2.5 text-sm font-bold transition-colors ${
              on
                ? "border-primary text-primary-dark"
                : "border-transparent text-text-muted hover:text-text-heading"
            }`}
          >
            {t.label}
            {t.slug === "users" && (
              <span className="ml-1.5">
                <SeatPill used={userCount} limit={userLimit} small />
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
