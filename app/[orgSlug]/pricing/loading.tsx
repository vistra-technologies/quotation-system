/**
 * Pricing list route — loading UI (Suspense boundary).
 *
 * Shown while the server renders the pricing list (session + DB round-trips).
 * Eliminates the blank-screen pause on navigation by streaming the shell immediately.
 *
 * Stage 12: added as part of the /pricing route group touch.
 */
export default function PricingLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 px-6 py-8 dark:bg-zinc-950 animate-pulse">
      <main className="mx-auto w-full max-w-5xl">
        {/* Page heading */}
        <div className="h-7 w-40 rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="mt-1 h-4 w-64 rounded bg-zinc-100 dark:bg-zinc-800" />

        <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {/* Table header */}
          <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <div className="h-4 w-28 rounded bg-zinc-100 dark:bg-zinc-800" />
          </div>

          {/* Table rows */}
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="flex gap-4 border-b border-zinc-100 px-5 py-3 last:border-0 dark:border-zinc-800"
            >
              <div className="h-4 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-4 w-20 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-4 w-32 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-4 w-12 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-4 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
