/**
 * Admin user detail route — loading UI (Suspense boundary).
 *
 * Shown while the server renders the user detail page (session + DB round-trips).
 * Eliminates the blank-screen pause on navigation by streaming the shell immediately.
 *
 * Stage 12: added as part of the /admin/users/[userId] route group touch.
 */
export default function AdminUserDetailLoading() {
  return (
    <div className="mx-auto max-w-lg animate-pulse">
      {/* Back link */}
      <div className="mb-4 h-4 w-20 rounded bg-zinc-100 dark:bg-zinc-800" />

      {/* Page title */}
      <div className="h-7 w-32 rounded bg-zinc-200 dark:bg-zinc-700" />

      {/* User metadata card */}
      <div className="mt-4 rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex justify-between gap-4">
              <div className="h-4 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-4 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      </div>

      {/* Action form cards */}
      <div className="mt-6 flex flex-col gap-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-zinc-200 bg-white px-5 py-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="h-8 w-28 rounded-md bg-zinc-200 dark:bg-zinc-700" />
          </div>
        ))}
      </div>
    </div>
  );
}
