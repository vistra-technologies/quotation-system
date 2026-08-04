/**
 * Pricing item detail route — loading UI (Suspense boundary).
 *
 * Shown while the server renders the item detail page (session + item + prices
 * DB round-trips). Eliminates the blank-screen pause on navigation.
 *
 * Stage 12: added as part of the /pricing/[itemId] route group touch.
 * Batch 8: restyled zinc-* classes to Sage Ease tokens.
 */
export default function PricingItemLoading() {
  return (
    <div className="mx-auto w-full max-w-lg px-6 py-8 animate-pulse">
      {/* Back link */}
      <div className="mb-4 h-4 w-24 rounded bg-primary-softer" />

      {/* Page heading */}
      <div className="h-7 w-48 rounded bg-border" />
      <div className="mt-1 h-4 w-56 rounded bg-primary-softer" />

      {/* Item metadata card */}
      <div className="mt-4 rounded-md border border-border bg-bg-card px-5 py-4 shadow-card">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="mb-2 flex justify-between gap-4 last:mb-0">
            <div className="h-4 w-20 rounded bg-primary-softer" />
            <div className="h-4 w-28 rounded bg-primary-softer" />
          </div>
        ))}
      </div>

      {/* Prices list */}
      <div className="mt-6 rounded-md border border-border bg-bg-card shadow-card">
        <div className="border-b border-border px-5 py-3">
          <div className="h-4 w-16 rounded bg-primary-softer" />
        </div>
        {[...Array(2)].map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between border-b border-border px-5 py-3 last:border-0"
          >
            <div className="h-4 w-24 rounded bg-primary-softer" />
            <div className="h-4 w-12 rounded bg-primary-softer" />
          </div>
        ))}
      </div>

      {/* Add price form */}
      <div className="mt-6 rounded-md border border-border bg-bg-card px-5 py-4 shadow-card">
        <div className="mb-4 h-4 w-20 rounded bg-primary-softer" />
        <div className="flex flex-col gap-4">
          <div className="h-9 w-full rounded bg-primary-softer" />
          <div className="h-9 w-full rounded bg-primary-softer" />
          <div className="h-9 w-20 rounded bg-border" />
        </div>
      </div>
    </div>
  );
}
