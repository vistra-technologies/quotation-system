/**
 * Configuration route — loading UI (Suspense boundary).
 *
 * Shown while the server renders the configuration page (session + project +
 * selections + component-types DB round-trips).
 * Eliminates the blank-screen pause when navigating to Step 2.
 *
 * Stage 12: added as part of the /projects/[projectId]/configuration route touch.
 * Batch 8: restyled zinc-* classes to Sage Ease tokens.
 */
export default function ConfigurationLoading() {
  return (
    <div className="animate-pulse">
      {/* Page heading placeholder */}
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="h-8 w-44 rounded bg-border" />
        <div className="h-4 w-64 rounded bg-primary-softer" />
      </div>

      {/* Selections section */}
      <section className="mb-8">
        <div className="mb-3 h-4 w-32 rounded bg-border" />
        <div className="rounded-md border border-border bg-bg-card shadow-card">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="flex gap-4 border-b border-border px-5 py-4 last:border-0"
            >
              <div className="h-4 w-6 rounded bg-primary-softer" />
              <div className="h-4 w-40 rounded bg-primary-softer" />
              <div className="h-4 w-28 rounded bg-primary-softer" />
            </div>
          ))}
        </div>
      </section>

      {/* Add component section */}
      <section>
        <div className="mb-3 h-4 w-36 rounded bg-border" />
        <div className="rounded-md border border-border bg-bg-card p-6 shadow-card space-y-4">
          <div className="h-9 w-full rounded bg-primary-softer" />
          <div className="h-9 w-full rounded bg-primary-softer" />
          <div className="h-9 w-28 rounded bg-border" />
        </div>
      </section>
    </div>
  );
}
