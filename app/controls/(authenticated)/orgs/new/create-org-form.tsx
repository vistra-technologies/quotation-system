"use client";

import { useActionState } from "react";
import { createOrg, type CreateOrgState } from "../actions";
import { RESERVED_ORG_SLUGS } from "@/lib/auth-utils";
import { FormulaSetPicker, type FormulaSetPickerItem } from "../_formula-set-picker";

const initialState: CreateOrgState = { error: null };

interface CreateOrgFormProps {
  /** Formula sets fetched server-side, passed down so the client component can group them. */
  formulaSets: FormulaSetPickerItem[];
  /** Translated hint for the org slug field (H-14). */
  slugHint: string;
  /** Translated hint for the admin password field (H-14). */
  adminPasswordHint: string;
}

/**
 * Client Component form for creating a new organization.
 *
 * Uses useActionState (React 19) so the server action can return a user-readable
 * error (e.g. reserved slug, duplicate slug) rather than crashing to an error boundary.
 *
 * Slug is auto-derived from the name as the user types (lowercase, hyphens for spaces,
 * stripping non-alphanumeric chars), but remains editable. The canonical validation
 * happens server-side in the route handler.
 *
 * Batch 5: adds a required formula-set picker (two-step: name → version).
 *
 * Stage 16 Batch C — F4; updated Stage 25 Batch 5.
 */
export function CreateOrgForm({ formulaSets, slugHint, adminPasswordHint }: CreateOrgFormProps) {
  const [state, formAction, isPending] = useActionState(createOrg, initialState);

  const inputCls =
    "rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]";
  const labelCls = "text-xs font-bold uppercase tracking-wide text-text-muted";

  function deriveSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "");
  }

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const slugInput = document.getElementById("orgSlug") as HTMLInputElement | null;
    if (slugInput && slugInput.dataset.userEdited !== "true") {
      slugInput.value = deriveSlug(e.target.value);
    }
  }

  function handleSlugChange(e: React.ChangeEvent<HTMLInputElement>) {
    e.target.dataset.userEdited = "true";
  }

  return (
    <>
      {state.error && (
        <div className="mb-4 rounded-sm border border-status-failed-bg bg-status-failed-bg px-4 py-3">
          <p className="text-sm text-status-failed-text">{state.error}</p>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-5">
        {/* Organization name */}
        <div className="flex flex-col gap-1">
          <label htmlFor="orgName" className={labelCls}>
            Organization name
          </label>
          <input
            id="orgName"
            name="name"
            type="text"
            required
            autoComplete="off"
            placeholder="e.g. Acme Glass Co."
            onChange={handleNameChange}
            className={inputCls}
          />
        </div>

        {/* Slug */}
        <div className="flex flex-col gap-1">
          <label htmlFor="orgSlug" className={labelCls}>
            Slug
          </label>
          <input
            id="orgSlug"
            name="slug"
            type="text"
            required
            autoComplete="off"
            placeholder="e.g. acme-glass"
            onChange={handleSlugChange}
            className={`${inputCls} font-mono`}
          />
          <p className="text-xs text-text-muted">
            {slugHint}
            <br />
            Reserved: <code className="font-mono">{RESERVED_ORG_SLUGS.join(", ")}</code>.
          </p>
        </div>

        {/* Admin password */}
        <div className="flex flex-col gap-1">
          <label htmlFor="adminPassword" className={labelCls}>
            Admin password
          </label>
          <input
            id="adminPassword"
            name="adminPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            className={inputCls}
          />
          <p className="text-xs text-text-muted">
            {adminPasswordHint}
          </p>
        </div>

        {/* User limit (optional; blank = default 3) */}
        <div className="flex flex-col gap-1">
          <label htmlFor="orgUserLimit" className={labelCls}>
            User limit
          </label>
          <input
            id="orgUserLimit"
            name="userLimit"
            type="number"
            min={1}
            max={10000}
            step={1}
            defaultValue={3}
            className={`${inputCls} max-w-[160px]`}
          />
          <p className="text-xs text-text-muted">
            Default 3 (1–10000). Every user counts toward the limit, active or deactivated. You can change it later on
            the org&apos;s Overview tab.
          </p>
        </div>

        {/* Divider */}
        <hr className="border-border" />

        {/* Formula set picker */}
        <FormulaSetPicker
          formulaSets={formulaSets}
        />

        <button
          type="submit"
          disabled={isPending}
          className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          {isPending ? "Creating…" : "Create organization"}
        </button>
      </form>
    </>
  );
}
