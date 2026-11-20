/**
 * Inventory list route: loading UI (Suspense boundary), the mockup's `loading` state: heading, tab strip, toolbar
 * and eight skeleton rows. Streams the shell immediately instead of a blank screen on navigation.
 *
 * Hotfix 2026-09-27 H-1: moved from /inventory to /admin/inventory. Stage 37 Batch 3: restyled.
 */
export default function InventoryLoading() {
  const bar = (w: string) => <div className={`h-3 animate-pulse rounded-sm bg-border ${w}`} />;
  return (
    <div aria-hidden="true">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="h-7 w-32 animate-pulse rounded-sm bg-border" />
        <div className="h-[34px] w-28 animate-pulse rounded-sm bg-border" />
      </div>
      <div className="mb-3.5 flex gap-6 border-b border-border pb-3">
        {bar("w-14")}
        {bar("w-16")}
        {bar("w-16")}
        {bar("w-20")}
      </div>
      <div className="mb-3 flex items-center gap-2">
        <div className="h-8 w-[260px] animate-pulse rounded-full bg-border" />
        <div className="h-[30px] w-20 animate-pulse rounded-full bg-border" />
        <div className="h-[30px] w-20 animate-pulse rounded-full bg-border" />
      </div>
      <div className="overflow-hidden rounded-sm border border-border bg-bg-white">
        <div className="h-[39px] border-b border-border bg-bg-subtle" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-6 border-b border-border px-3.5 py-[15px] last:border-b-0">
            {bar("w-[110px]")}
            {bar("w-[240px]")}
            {bar("w-[40px]")}
            {bar("w-[50px]")}
            {bar("w-[52px]")}
          </div>
        ))}
      </div>
    </div>
  );
}
