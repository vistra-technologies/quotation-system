/**
 * Admin users list route — loading UI (Suspense boundary).
 *
 * Shown while the server renders the users list (session + DB round-trips).
 * Eliminates the blank-screen pause on navigation by streaming the shell immediately.
 *
 * Stage 12: added as part of the /admin/users route group touch.
 */
export default function AdminUsersLoading() {
  return (
    <div className="animate-pulse">
      {/* Page heading + create button */}
      <div className="flex items-start justify-between">
        <div>
          <div className="h-7 w-24 rounded-sm bg-border" />
          <div className="mt-1 h-4 w-48 rounded-sm bg-border/60" />
        </div>
        <div className="h-9 w-28 rounded-sm bg-border" />
      </div>

      {/* Users table */}
      <div className="mt-6 rounded-md border border-border bg-bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {[80, 64, 56, 24].map((w, i) => (
                  <th key={i} className="px-5 py-3">
                    <div
                      className={`h-4 w-${w === 24 ? "0" : `[${w}px]`} rounded-sm bg-border/60`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...Array(4)].map((_, i) => (
                <tr
                  key={i}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="px-5 py-3">
                    <div className="h-4 w-24 rounded-sm bg-border/60" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-4 w-16 rounded-sm bg-border/60" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-5 w-14 rounded-pill bg-border/60" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="ml-auto h-4 w-10 rounded-sm bg-border/60" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
