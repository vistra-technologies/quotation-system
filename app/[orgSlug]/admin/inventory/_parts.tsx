"use client";

import { useTranslations } from "next-intl";
import type { ListItem } from "@/lib/inventory-list";

/** Small pieces shared by the Inventory list and the item drawer (view and edit). */

export function InfoTip({ text }: { text: string }) {
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-text-muted text-[10px] font-extrabold normal-case tracking-normal text-text-muted"
    >
      i
    </span>
  );
}

const LINK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);

/**
 * "Also matched by <code>, <code>" with each code a button that switches to that item. The message carries the
 * codes as a tag (`<codes></codes>`): a plain ICU argument would pass the function through as a value and render
 * nothing (review R-A finding 1, pinned by tests/unit/inventory-also-matched-by-copy.test.ts).
 */
export function AlsoMatchedBy({
  others,
  onOpenItem,
  inList,
}: {
  others: ListItem[];
  onOpenItem: (id: string) => void;
  inList?: boolean;
}) {
  const t = useTranslations("inventory");
  if (others.length === 0) return null;
  const codes = others.map((o, i) => (
    <span key={o.id}>
      {i > 0 ? ", " : ""}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenItem(o.id);
        }}
        className="font-mono font-semibold text-primary-dark underline underline-offset-2 hover:text-text-heading focus-visible:outline-2 focus-visible:outline-primary"
      >
        {o.code}
      </button>
    </span>
  ));
  return (
    <div className={`${inList ? "mt-0.5 text-[11.5px]" : "mt-2 text-xs"} flex items-center gap-1.5 text-text-muted`}>
      {LINK_ICON}
      <span>{t.rich("alsoMatchedBy", { codes: () => <>{codes}</> })}</span>
    </div>
  );
}

export function DRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <dt className="text-[13px] text-text-muted">{label}</dt>
      <dd className="text-right text-[13px] font-semibold text-text-heading">{children}</dd>
    </div>
  );
}
