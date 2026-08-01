/**
 * Orders list route — loading UI (Suspense boundary).
 *
 * Shown while the server renders the orders list (session round-trip).
 * Eliminates the blank-screen pause on navigation by streaming the shell immediately.
 *
 * Stage 12 Batch 7e: matches the orders list structure — no action button in
 * the header (no "New Order" creation flow), 7-column table skeleton.
 */
export default function OrdersLoading() {
  return (
    <div className="animate-pulse">
      {/* Page header — no action button (orders come from the pipeline) */}
      <div className="mb-5 flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-8 w-36 rounded-sm bg-border" />
          <div className="h-4 w-52 rounded-sm bg-border/60" />
        </div>
      </div>

      {/* Toolbar skeleton */}
      <div className="mb-4 flex items-center justify-between">
        <div className="h-9 w-32 rounded-sm bg-border" />
        <div className="flex items-center gap-2">
          <div className="h-9 w-[230px] rounded-sm bg-border" />
          <div className="h-9 w-44 rounded-sm bg-border" />
        </div>
      </div>

      {/* Table card skeleton */}
      <div className="rounded-md border border-border bg-bg-card">
        <div className="px-4">
          {/* Header row — 7 columns */}
          <div className="flex gap-4 border-b border-border py-[10px]">
            {[160, 120, 90, 70, 70, 90, 90].map((w, i) => (
              <div key={i} className={`h-3 rounded-sm bg-border/80 w-[${w}px]`} />
            ))}
          </div>
          {/* Data rows */}
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="flex gap-4 border-b border-border/60 py-[11px] last:border-0"
            >
              <div className="h-4 w-40 rounded-sm bg-border/60" />
              <div className="h-4 w-28 rounded-sm bg-border/60" />
              <div className="h-4 w-20 rounded-sm bg-border/60" />
              <div className="h-5 w-16 rounded-pill bg-border/60" />
              <div className="h-4 w-16 rounded-sm bg-border/60" />
              <div className="h-4 w-20 rounded-sm bg-border/60" />
              <div className="h-4 w-8 rounded-sm bg-border/60" />
            </div>
          ))}
        </div>
        {/* Pagination skeleton */}
        <div className="flex items-center justify-between px-3 pb-3 pt-3">
          <div className="h-4 w-40 rounded-sm bg-border/60" />
          <div className="flex gap-1">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-7 w-7 rounded-sm bg-border" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
