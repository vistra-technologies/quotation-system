/**
 * Inquiry detail route — loading UI (Suspense boundary).
 *
 * Shown while the server renders the inquiry detail page (session + DB round-trips).
 * Eliminates the blank-screen pause when navigating into an inquiry.
 *
 * Stage 12: added as part of the /inquiries/[inquiryId] route group touch.
 * Batch 8: zinc skeleton classes replaced with Sage Ease tokens (bg-primary-softer,
 * bg-border) so dark-mode users no longer see a black-background skeleton.
 */
export default function InquiryDetailLoading() {
  return (
    <div className="animate-pulse">
      {/* Back link placeholder */}
      <div className="mb-4 h-4 w-28 rounded bg-primary-softer" />

      {/* Heading */}
      <div className="mb-6 space-y-2">
        <div className="h-8 w-64 rounded bg-border" />
        <div className="flex flex-wrap gap-4">
          <div className="h-4 w-20 rounded bg-primary-softer" />
          <div className="h-4 w-12 rounded bg-primary-softer" />
          <div className="h-5 w-16 rounded-full bg-primary-softer" />
          <div className="h-4 w-24 rounded bg-primary-softer" />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <div className="h-9 w-24 rounded-md bg-border" />
        <div className="h-9 w-32 rounded-md bg-border" />
      </div>
    </div>
  );
}
