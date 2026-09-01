import Link from "next/link";
import { CreateOrgForm } from "./create-org-form";

// Always render live — auth enforced by the guard layout.
export const dynamic = "force-dynamic";

/**
 * Create-org page (Server Component shell).
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx — do not re-call
 * requireSuperAdmin() here.
 *
 * Delegates the interactive form to CreateOrgForm (Client Component).
 *
 * Stage 16 Batch C — F4.
 */
export default function NewOrgPage() {
  return (
    <div className="mx-auto max-w-lg">
      <Link
        href="/controls/orgs"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        ← Back to organizations
      </Link>

      <h1 className="mt-2 text-2xl font-bold text-text-heading">
        Create organization
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        A new organization with default roles will be created immediately.
      </p>

      <div className="mt-6 rounded-md border border-border bg-bg-card p-6 shadow-card">
        <CreateOrgForm />
      </div>
    </div>
  );
}
