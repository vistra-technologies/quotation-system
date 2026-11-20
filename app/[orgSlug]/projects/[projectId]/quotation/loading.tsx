/**
 * Quotation step, loading UI (Suspense boundary). Stage 38 Batch 4: the skeleton of mockup B (header, meta band,
 * four KPI tiles, ledger rows), shown while the server renders the page. Stage 19 bugs-3 M5 (navigation indicators).
 */
const BAR = "animate-pulse rounded-sm bg-border motion-reduce:animate-none";

export default function QuotationLoading() {
  return (
    <div className="py-8">
      <div className="mb-6 rounded-md border border-border bg-bg-card p-5 shadow-card" aria-busy="true" aria-label="Loading quotation">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-2.5">
            <div className={`h-5 w-[160px] ${BAR}`} />
            <div className={`h-3 w-[320px] ${BAR}`} />
          </div>
          <div className="flex gap-2.5">
            {["w-[96px]", "w-[128px]", "w-[88px]", "w-[112px]"].map((w) => (
              <div key={w} className={`h-9 ${w} ${BAR}`} />
            ))}
          </div>
        </div>
        <div className="mt-4 h-[56px] rounded-md border border-border bg-bg-white" />
        <div className="mt-5 grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2 rounded-sm border border-border bg-bg-white px-4 py-4">
              <div className={`h-3 w-[60px] ${BAR}`} />
              <div className={`h-5 w-[110px] ${BAR}`} />
            </div>
          ))}
        </div>
        <div className="mt-6 overflow-hidden rounded-sm border border-border bg-bg-white">
          <div className="h-[30px] border-b border-border bg-primary-softer" />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="flex items-center gap-6 border-b border-border px-2.5 py-[11px] last:border-b-0">
              <div className={`h-3 w-[20px] ${BAR}`} />
              <div className={`h-3 w-[110px] ${BAR}`} />
              <div className={`h-3 w-[260px] ${BAR}`} />
              <span className="flex-1" />
              <div className={`h-3 w-[70px] ${BAR}`} />
              <div className={`h-3 w-[110px] ${BAR}`} />
              <div className={`h-3 w-[80px] ${BAR}`} />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-start">
        <div className={`h-10 w-24 ${BAR}`} />
      </div>
    </div>
  );
}
