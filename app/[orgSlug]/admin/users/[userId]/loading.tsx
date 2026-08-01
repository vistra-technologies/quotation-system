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
      <div className="mb-4 h-4 w-20 rounded-sm bg-border/60" />

      {/* Page title */}
      <div className="h-7 w-32 rounded-sm bg-border" />

      {/* User metadata card */}
      <div className="mt-4 rounded-md border border-border bg-bg-card px-5 py-4">
        <div className="flex flex-col gap-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex justify-between gap-4">
              <div className="h-4 w-16 rounded-sm bg-border/60" />
              <div className="h-4 w-24 rounded-sm bg-border/60" />
            </div>
          ))}
        </div>
      </div>

      {/* Action form cards */}
      <div className="mt-6 flex flex-col gap-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="rounded-md border border-border bg-bg-card px-5 py-5"
          >
            <div className="h-8 w-28 rounded-sm bg-border" />
          </div>
        ))}
      </div>
    </div>
  );
}
