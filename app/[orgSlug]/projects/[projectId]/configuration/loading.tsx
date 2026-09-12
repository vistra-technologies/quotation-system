/**
 * Configuration route — loading UI (Suspense boundary).
 *
 * Shown while the server renders the configuration page (session + project +
 * selections + component-types DB round-trips).
 * Eliminates the blank-screen pause when navigating to Step 2.
 *
 * Stage 12: added as part of the /projects/[projectId]/configuration route touch.
 * Batch 8: restyled zinc-* classes to Sage Ease tokens.
 * Stage 19 Batch 3: rewritten to mirror the live 3-column grid-cols-[200px_1fr_300px]
 * layout added in Stage 17, replacing the old 2-section list+form skeleton.
 */
export default function ConfigurationLoading() {
  return (
    <div className="animate-pulse grid grid-cols-[200px_1fr_300px] gap-6 p-7">

      {/* ── Left column (200px): component-type sidebar tiles ── */}
      <div className="flex flex-col gap-3.5">
        <div className="h-3 w-24 rounded bg-border" />
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-2 rounded-md border border-border bg-bg-card py-[22px] px-3"
          >
            <div className="h-6 w-6 rounded bg-primary-softer" />
            <div className="h-3 w-16 rounded bg-primary-softer" />
          </div>
        ))}
      </div>

      {/* ── Center column (1fr): add/edit form ── */}
      <div className="flex flex-col gap-5">
        <div className="h-6 w-40 rounded bg-border" />
        {/* Label field row */}
        <div className="flex flex-col gap-1.5">
          <div className="h-3 w-16 rounded bg-border" />
          <div className="h-9 w-full rounded bg-primary-softer" />
        </div>
        {/* Field row 1 */}
        <div className="flex flex-col gap-1.5">
          <div className="h-3 w-20 rounded bg-border" />
          <div className="h-9 w-full rounded bg-primary-softer" />
        </div>
        {/* Field row 2 — paired (2-column) */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="h-3 w-16 rounded bg-border" />
            <div className="h-9 w-full rounded bg-primary-softer" />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="h-3 w-16 rounded bg-border" />
            <div className="h-9 w-full rounded bg-primary-softer" />
          </div>
        </div>
        {/* Configure button placeholder */}
        <div className="h-10 w-full rounded bg-primary-softer" />
        {/* Submit button placeholder */}
        <div className="h-10 w-full rounded bg-border" />
      </div>

      {/* ── Right column (300px): saved components list ── */}
      <div className="flex flex-col gap-2.5">
        <div className="h-3 w-28 rounded bg-border" />
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-sm border border-border bg-bg-white px-3.5 py-3"
          >
            <div className="h-[34px] w-[34px] shrink-0 rounded-[8px] bg-primary-softer" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="h-3 w-28 rounded bg-border" />
              <div className="h-2.5 w-20 rounded bg-primary-softer" />
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
