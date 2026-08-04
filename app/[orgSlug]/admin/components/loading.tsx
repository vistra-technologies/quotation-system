/**
 * Loading skeleton for the admin components route group.
 * Displayed while the Server Component fetches session + component-type data.
 */
export default function ComponentsLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-6 h-12 rounded-lg border border-amber-200 bg-amber-50" />
      <div className="flex items-center justify-between">
        <div className="h-8 w-56 rounded-sm bg-border" />
        <div className="h-9 w-36 rounded-sm bg-border" />
      </div>
      <div className="mt-6 rounded-md border border-border bg-bg-card">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border/60 px-5 py-4 last:border-0"
          >
            <div className="h-4 w-20 rounded-sm bg-border" />
            <div className="h-4 w-32 rounded-sm bg-border" />
            <div className="h-4 w-24 rounded-sm bg-border/60" />
            <div className="h-4 w-16 rounded-sm bg-border/60" />
          </div>
        ))}
      </div>
    </div>
  );
}
