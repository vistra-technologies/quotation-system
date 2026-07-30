/**
 * Project detail / wizard route — loading UI (Suspense boundary).
 *
 * Shown while the server renders the project wizard (session + project DB round-trips).
 * Eliminates the blank-screen pause when navigating into a project.
 *
 * Stage 12: added as part of the /projects/[projectId] route group touch.
 */
export default function ProjectDetailLoading() {
  return (
    <div className="animate-pulse">
      {/* Breadcrumb placeholder */}
      <div className="mb-6 flex justify-center gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-4 w-20 rounded bg-zinc-200 dark:bg-zinc-700" />
        ))}
      </div>

      {/* Back link placeholder */}
      <div className="mb-6 h-4 w-28 rounded bg-zinc-100 dark:bg-zinc-800" />

      {/* Heading */}
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="h-8 w-48 rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="h-4 w-64 rounded bg-zinc-100 dark:bg-zinc-800" />
      </div>

      {/* Metadata card */}
      <div className="mb-6 rounded-md border border-border bg-bg-card p-7 shadow-card space-y-3">
        <div className="h-6 w-56 rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="flex gap-3">
          <div className="h-4 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-4 w-12 rounded bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-4 w-20 rounded bg-zinc-100 dark:bg-zinc-800" />
        </div>
      </div>

      {/* Footer buttons */}
      <div className="flex justify-end gap-3">
        <div className="h-10 w-32 rounded-sm bg-zinc-200 dark:bg-zinc-700" />
        <div className="h-10 w-40 rounded-sm bg-zinc-200 dark:bg-zinc-700" />
      </div>
    </div>
  );
}
