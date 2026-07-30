/**
 * Inquiry detail route — loading UI (Suspense boundary).
 *
 * Shown while the server renders the inquiry detail page (session + DB round-trips).
 * Eliminates the blank-screen pause when navigating into an inquiry.
 *
 * Stage 12: added as part of the /inquiries/[inquiryId] route group touch.
 */
export default function InquiryDetailLoading() {
  return (
    <div className="animate-pulse">
      {/* Back link placeholder */}
      <div className="mb-4 h-4 w-28 rounded bg-zinc-100 dark:bg-zinc-800" />

      {/* Heading */}
      <div className="mb-6 space-y-2">
        <div className="h-8 w-64 rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="flex flex-wrap gap-4">
          <div className="h-4 w-20 rounded bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-4 w-12 rounded bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-5 w-16 rounded-full bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-4 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <div className="h-9 w-24 rounded-md bg-zinc-200 dark:bg-zinc-700" />
        <div className="h-9 w-32 rounded-md bg-zinc-200 dark:bg-zinc-700" />
      </div>
    </div>
  );
}
