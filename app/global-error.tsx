"use client";

import "./globals.css";

/**
 * Root-level fallback (Next.js file convention: must define its own <html>/<body>,
 * since it replaces the root layout entirely when active). Without this, an error
 * thrown above every other boundary (e.g. in app/layout.tsx itself) falls through to
 * Next's minimal built-in crash page with no recovery action.
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
      <body className="flex min-h-full flex-col items-center justify-center gap-3 bg-zinc-50 p-6 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          Something went wrong.
        </h2>
        {error.digest && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Error reference: {error.digest}
          </p>
        )}
        <button
          onClick={() => unstable_retry()}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
