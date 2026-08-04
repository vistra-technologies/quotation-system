"use client";

import "./globals.css";

/**
 * Root-level fallback (Next.js file convention: must define its own <html>/<body>,
 * since it replaces the root layout entirely when active). Without this, an error
 * thrown above every other boundary (e.g. in app/layout.tsx itself) falls through to
 * Next's minimal built-in crash page with no recovery action.
 *
 * Batch 8 reconciliation: applied Sage Ease design tokens (bg-bg-page,
 * text-text-heading, text-text-muted, bg-primary, text-text-on-primary).
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col items-center justify-center gap-3 bg-bg-page p-6">
        <h2 className="text-sm font-semibold text-text-heading">
          Something went wrong.
        </h2>
        {error.digest && (
          <p className="text-xs text-text-muted">
            Error reference: {error.digest}
          </p>
        )}
        <button
          onClick={() => unstable_retry()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-text-on-primary hover:bg-primary-dark"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
