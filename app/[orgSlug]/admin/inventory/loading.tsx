/**
 * Inventory list route — loading UI (Suspense boundary).
 *
 * Shown while the server renders the inventory list (session + DB round-trips).
 * Eliminates the blank-screen pause on navigation by streaming the shell immediately.
 *
 * Hotfix 2026-09-27 H-1: moved from /inventory to /admin/inventory.
 */
export default function InventoryLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 animate-pulse">
      {/* Page heading */}
      <div className="h-7 w-40 rounded bg-border" />
      <div className="mt-1 h-4 w-64 rounded bg-primary-softer" />

      <div className="mt-6 rounded-md border border-border bg-bg-card shadow-card">
        {/* Table header */}
        <div className="border-b border-border px-5 py-3">
          <div className="h-4 w-28 rounded bg-primary-softer" />
        </div>

        {/* Table rows */}
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="flex gap-4 border-b border-border px-5 py-3 last:border-0"
          >
            <div className="h-4 w-16 rounded bg-primary-softer" />
            <div className="h-4 w-20 rounded bg-primary-softer" />
            <div className="h-4 w-32 rounded bg-primary-softer" />
            <div className="h-4 w-12 rounded bg-primary-softer" />
          </div>
        ))}
      </div>
    </div>
  );
}
