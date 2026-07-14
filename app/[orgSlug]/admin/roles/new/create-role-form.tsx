"use client";

import { useFormStatus } from "react-dom";
import { LoadingOverlay } from "@/components/loading-overlay";
import { createRole } from "../actions";

/**
 * Renders the loading overlay while the enclosing form action is pending.
 * Must be a direct child of the <form> so useFormStatus() can find it.
 */
function PendingOverlay() {
  const { pending } = useFormStatus();
  return <LoadingOverlay visible={pending} />;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {label}
    </button>
  );
}

interface CreateRoleFormProps {
  orgSlug: string;
  fieldNameLabel: string;
  fieldDescriptionLabel: string;
  submitLabel: string;
}

/**
 * Create-role form (Client Component).
 *
 * Receives translated label strings from the Server Component parent so we
 * don't need to call useTranslations() here — NextIntlClientProvider is
 * already in scope from the admin layout, but passing strings as props avoids
 * adding the hook dependency and keeps translation calls co-located with the
 * Server Component that owns the page.
 */
export function CreateRoleForm({
  orgSlug,
  fieldNameLabel,
  fieldDescriptionLabel,
  submitLabel,
}: CreateRoleFormProps) {
  return (
    <form action={createRole} className="flex flex-col gap-4">
      {/* PendingOverlay is inside <form> so useFormStatus() resolves correctly */}
      <PendingOverlay />

      <input type="hidden" name="orgSlug" value={orgSlug} />

      <div className="flex flex-col gap-1">
        <label
          htmlFor="name"
          className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          {fieldNameLabel}
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          autoComplete="off"
          className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="description"
          className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          {fieldDescriptionLabel}
        </label>
        <input
          id="description"
          name="description"
          type="text"
          autoComplete="off"
          className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
        />
      </div>

      <SubmitButton label={submitLabel} />
    </form>
  );
}
