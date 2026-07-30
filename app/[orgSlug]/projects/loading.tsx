/**
 * Projects list route — loading UI (Suspense boundary).
 *
 * Shown while the server renders the projects list (session + DB round-trips).
 * Eliminates the blank-screen pause on navigation by streaming the shell immediately.
 *
 * Stage 12: added as part of the /projects route group touch.
 */
export default function ProjectsLoading() {
  return (
    <div className="animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-7 w-36 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-52 rounded bg-zinc-100 dark:bg-zinc-800" />
        </div>
        <div className="h-9 w-32 rounded-md bg-zinc-200 dark:bg-zinc-700" />
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="flex gap-4 border-b border-zinc-100 px-5 py-3 last:border-0 dark:border-zinc-800"
          >
            <div className="h-4 w-12 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 w-40 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 w-20 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 w-32 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
