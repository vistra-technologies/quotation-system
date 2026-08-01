/**
 * Loading skeleton for the admin components route group.
 * Displayed while the Server Component fetches session + component-type data.
 */
export default function ComponentsLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-6 h-12 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950" />
      <div className="flex items-center justify-between">
        <div className="h-8 w-56 rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="h-9 w-36 rounded-md bg-zinc-200 dark:bg-zinc-700" />
      </div>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-zinc-100 px-5 py-4 last:border-0 dark:border-zinc-800"
          >
            <div className="h-4 w-20 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-4 w-32 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-4 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
