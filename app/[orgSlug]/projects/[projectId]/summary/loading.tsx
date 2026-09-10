/**
 * Summary step — loading UI (Suspense boundary).
 *
 * Shown while the server renders the summary page (fetchProjectDetail + step-gate
 * check). Eliminates the blank-screen pause when navigating to the Summary step.
 *
 * Stage 19 bugs-3 M5 — navigation loading indicators.
 */
export default function SummaryLoading() {
  return (
    <div className="animate-pulse">
      {/* Page heading placeholder */}
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="h-8 w-28 rounded-sm bg-border" />
        <div className="h-4 w-72 rounded-sm bg-primary-softer" />
      </div>

      {/* Content card placeholder */}
      <div className="mb-6 rounded-md border border-border bg-bg-card shadow-card">
        <div className="m-5 rounded-md border border-dashed border-border px-6 py-16 flex flex-col items-center gap-3">
          <div className="h-11 w-11 rounded-[10px] bg-border" />
          <div className="h-4 w-40 rounded-sm bg-border/60" />
          <div className="h-3 w-56 rounded-sm bg-border/40" />
        </div>
      </div>

      {/* Card footer navigation */}
      <div className="flex items-center justify-between">
        <div className="h-10 w-24 rounded-sm bg-border" />
        <div className="h-10 w-36 rounded-sm bg-border" />
      </div>
    </div>
  );
}
