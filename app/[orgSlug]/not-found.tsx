/**
 * Org-scoped 404 page (Server Component).
 *
 * Renders inside app/[orgSlug]/layout.tsx — the org shell (sidebar + top bar)
 * wraps this automatically when the user has an active session. If no session
 * is present, the layout renders children directly without the shell.
 *
 * Displayed when a URL within a known org matches the [orgSlug] segment but
 * has no corresponding page.tsx — e.g. /{orgSlug}/nonexistent-route.
 *
 * Navigation back into the app is available via the sidebar; no explicit back
 * link is needed here.
 *
 * Stage 11 (Batch 9): new file.
 */
export default function OrgNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="mb-2 text-xs font-bold uppercase tracking-widest text-text-muted">
        404
      </p>
      <h1 className="text-2xl font-extrabold tracking-tight text-text-heading">
        Page not found
      </h1>
      <p className="mt-3 max-w-xs text-sm text-text-muted">
        This page doesn&apos;t exist within your organization. Use the sidebar
        to navigate to a valid section.
      </p>
    </div>
  );
}
