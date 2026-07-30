/**
 * Pricing item detail route — loading UI (Suspense boundary).
 *
 * Shown while the server renders the item detail page (session + item + prices
 * DB round-trips). Eliminates the blank-screen pause on navigation.
 *
 * Stage 12: added as part of the /pricing/[itemId] route group touch.
 */
export default function PricingItemLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 px-6 py-8 dark:bg-zinc-950 animate-pulse">
      <main className="mx-auto w-full max-w-lg">
        {/* Back link */}
        <div className="mb-4 h-4 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />

        {/* Page heading */}
        <div className="h-7 w-48 rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="mt-1 h-4 w-56 rounded bg-zinc-100 dark:bg-zinc-800" />

        {/* Item metadata card */}
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="mb-2 flex justify-between gap-4 last:mb-0">
              <div className="h-4 w-20 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-4 w-28 rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          ))}
        </div>

        {/* Prices list */}
        <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <div className="h-4 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
          </div>
          {[...Array(2)].map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 last:border-0 dark:border-zinc-800"
            >
              <div className="h-4 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-4 w-12 rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          ))}
        </div>

        {/* Add price form */}
        <div className="mt-6 rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4 h-4 w-20 rounded bg-zinc-100 dark:bg-zinc-800" />
          <div className="flex flex-col gap-4">
            <div className="h-9 w-full rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-9 w-full rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-9 w-20 rounded bg-zinc-200 dark:bg-zinc-700" />
          </div>
        </div>
      </main>
    </div>
  );
}
