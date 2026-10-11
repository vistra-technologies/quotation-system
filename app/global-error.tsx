"use client";

import { useEffect, useState } from "react";
import { reportClientError } from "@/lib/client-error-report";
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
  // Stage 32 (S32-7): without a digest, the ref reportClientError generated and sent is the reference.
  const [ref, setRef] = useState<string | undefined>();
  useEffect(() => {
    // The ref only exists after the report is sent (sessionStorage dedupe), so it is state set from the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRef(reportClientError(error, "global"));
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col items-center justify-center gap-3 bg-bg-page p-6">
        <h2 className="text-sm font-semibold text-text-heading">
          Something went wrong.
        </h2>
        {(error.digest || ref) && (
          <p className="text-xs text-text-muted">
            Error reference: {error.digest || ref}
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
