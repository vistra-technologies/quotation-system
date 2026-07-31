/**
 * Loading skeleton for the admin roles route group.
 * Displayed while the Server Component fetches session + role data.
 */
export default function RolesLoading() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-48 rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="h-9 w-28 rounded-md bg-zinc-200 dark:bg-zinc-700" />
      </div>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-zinc-100 px-5 py-4 last:border-0 dark:border-zinc-800"
          >
            <div className="h-4 w-32 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-4 flex-1 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 w-16 rounded bg-zinc-200 dark:bg-zinc-700" />
          </div>
        ))}
      </div>
    </div>
  );
}
