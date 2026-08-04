import Link from "next/link";

/**
 * Root-level 404 page (Server Component).
 *
 * Renders inside app/layout.tsx (fonts only — no org shell).
 * Standalone Sage Ease styled page with a link back to the apex org selector.
 *
 * Stage 11 (Batch 9): new file.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-page px-6">
      <main className="w-full max-w-sm text-center">
        {/* Logo mark */}
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-md bg-primary">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M14 2.5H6.8a1.8 1.8 0 0 0-1.8 1.8v15.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.3z"
              stroke="white"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M14 2.5v5.8h5.2"
              stroke="white"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8.6 14.2l2 2 4-4.4"
              stroke="white"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-text-muted">
          404
        </p>
        <h1 className="text-2xl font-extrabold tracking-tight text-text-heading">
          Page not found
        </h1>
        <p className="mt-3 text-sm text-text-muted">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <Link
          href="/"
          className="mt-8 inline-flex items-center rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
        >
          Back to EaseeTool
        </Link>
      </main>
    </div>
  );
}
