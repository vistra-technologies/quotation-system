/**
 * Design step — loading UI (Suspense boundary).
 *
 * Shown while the server renders the design workspace (floors + rooms + selections
 * fetched in parallel via internalFetch). Eliminates the blank-screen pause when
 * navigating into the Design step from the wizard breadcrumb or breadcrumb links.
 *
 * Stage 19 bugs-3 M5 — navigation loading indicators.
 */
export default function DesignLoading() {
  return (
    <div className="animate-pulse">
      {/* Page heading placeholder */}
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="h-8 w-32 rounded-sm bg-border" />
        <div className="h-4 w-56 rounded-sm bg-primary-softer" />
      </div>

      {/* Main design workspace card placeholder */}
      <div className="rounded-md border border-border bg-bg-card shadow-card">
        {/* Toolbar row */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="h-5 w-24 rounded-sm bg-border" />
          <div className="flex gap-2">
            <div className="h-8 w-20 rounded-sm bg-border" />
            <div className="h-8 w-20 rounded-sm bg-border" />
          </div>
        </div>
        {/* Canvas area */}
        <div className="flex min-h-[320px] items-center justify-center p-8">
          <div className="h-16 w-48 rounded-sm bg-border/60" />
        </div>
      </div>

      {/* Card footer navigation */}
      <div className="mt-6 flex items-center justify-between">
        <div className="h-10 w-24 rounded-sm bg-border" />
        <div className="h-10 w-36 rounded-sm bg-border" />
      </div>
    </div>
  );
}
