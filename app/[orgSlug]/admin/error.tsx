"use client";

import { useEffect } from "react";

/**
 * Scoped error boundary for the /[orgSlug]/admin/* sub-tree.
 *
 * Without this, an uncaught error in any admin page bubbles past `admin/layout.tsx`
 * entirely, unmounting its header/nav along with the page — leaving the user with no
 * way to navigate except the browser back button. Scoping the boundary here keeps
 * the admin layout (and its nav) mounted; only the failing page content is replaced.
 */
export default function AdminError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950">
      <h2 className="text-sm font-semibold text-red-800 dark:text-red-200">
        Something went wrong loading this page.
      </h2>
      {error.digest && (
        <p className="text-xs text-red-600 dark:text-red-400">
          Error reference: {error.digest}
        </p>
      )}
      <button
        onClick={() => unstable_retry()}
        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
      >
        Try again
      </button>
    </div>
  );
}
