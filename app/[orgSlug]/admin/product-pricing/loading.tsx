/**
 * Product Pricing route: loading UI (Suspense boundary). Skeleton of the tab bar and the table while the
 * server renders (Stage 36 S36-15), same idea as admin/inventory/loading.tsx.
 */
export default function ProductPricingLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-7 w-44 rounded bg-border" />
      <div className="mt-5 flex gap-6 border-b border-border pb-3">
        <div className="h-4 w-32 rounded bg-primary-softer" />
        <div className="h-4 w-28 rounded bg-primary-softer" />
      </div>
      <div className="mt-4 h-8 w-64 rounded-full bg-primary-softer" />
      <div className="mt-3 rounded-md border border-border bg-bg-white">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex gap-6 border-b border-border px-4 py-3.5 last:border-0">
            <div className="h-4 w-28 rounded bg-primary-softer" />
            <div className="h-4 w-16 rounded bg-primary-softer" />
            <div className="h-4 w-40 rounded bg-primary-softer" />
            <div className="h-4 w-32 rounded bg-primary-softer" />
          </div>
        ))}
      </div>
    </div>
  );
}
