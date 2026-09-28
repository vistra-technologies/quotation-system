"use client";

import { useSelectedLayoutSegment } from "next/navigation";

/**
 * Width wrapper for every `/[orgSlug]/admin/*` page — extracted out of `admin/layout.tsx` so the
 * Catalog page can opt out of the shared `max-w-5xl` cap without touching any of the other
 * (deliberately narrower, form-like) admin pages.
 *
 * Catalog's dependency-tree canvas was built to fill the full content column, per the locked
 * mockup's `.eq-content { padding: 24px 32px 48px; width: 100%; }` (explicit "no max-width cap"
 * comment there). Centering it inside a 1024px box left large unused margins on wide screens and
 * starved the tree's `minmax(220px, 1fr)` grid columns of the surplus width their `1fr` share
 * needs — the cause of the DOOR segment's rightmost-tier label clipping (Stage 27 fix, see
 * `.engineering-fix-notes.md`).
 *
 * Every other admin page keeps the exact classes `admin/layout.tsx` used before this change.
 */
export function AdminContentShell({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();

  if (segment === "catalog") {
    return <div className="w-full px-8 pb-12 pt-6">{children}</div>;
  }

  return <div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>;
}
