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
          <div className="h-7 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="mt-1 h-4 w-48 rounded bg-zinc-100 dark:bg-zinc-800" />
        </div>
        <div className="h-9 w-28 rounded-md bg-zinc-200 dark:bg-zinc-700" />
      </div>

      {/* Users table */}
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                {[80, 64, 56, 24].map((w, i) => (
                  <th key={i} className="px-5 py-3">
                    <div
                      className={`h-4 w-${w === 24 ? "0" : `[${w}px]`} rounded bg-zinc-100 dark:bg-zinc-800`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...Array(4)].map((_, i) => (
                <tr
                  key={i}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                >
                  <td className="px-5 py-3">
                    <div className="h-4 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-4 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-5 w-14 rounded-full bg-zinc-100 dark:bg-zinc-800" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="ml-auto h-4 w-10 rounded bg-zinc-100 dark:bg-zinc-800" />
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
