/**
 * Loading skeleton for the admin permissions route group.
 * Displayed while the Server Component fetches session + permission data.
 */
export default function PermissionsLoading() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-48 rounded-sm bg-border" />
        <div className="h-9 w-36 rounded-sm bg-border" />
      </div>
      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
        <div className="h-4 w-3/4 rounded bg-amber-200" />
      </div>
      <div className="mt-4 rounded-md border border-border bg-bg-card">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border/60 px-5 py-4 last:border-0"
          >
            <div className="h-4 w-32 rounded-sm bg-border" />
            <div className="h-4 flex-1 rounded-sm bg-border/60" />
          </div>
        ))}
      </div>
    </div>
  );
}
