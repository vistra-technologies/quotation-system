/**
 * Loading skeleton for the admin roles route group.
 * Displayed while the Server Component fetches session + role data.
 */
export default function RolesLoading() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-48 rounded-sm bg-border" />
        <div className="h-9 w-28 rounded-sm bg-border" />
      </div>
      <div className="mt-6 rounded-md border border-border bg-bg-card">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border/60 px-5 py-4 last:border-0"
          >
            <div className="h-4 w-32 rounded-sm bg-border" />
            <div className="h-4 flex-1 rounded-sm bg-border/60" />
            <div className="h-4 w-16 rounded-sm bg-border" />
          </div>
        ))}
      </div>
    </div>
  );
}
