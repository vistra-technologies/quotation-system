"use client";

import { useRouter } from "next/navigation";

interface OrgPickerProps {
  orgs: Array<{ id: string; name: string; slug: string }>;
  selectedOrgId: string | null;
}

/**
 * Org picker dropdown (Client Component).
 *
 * Renders a <select> over all organizations. On change, navigates to
 * /controls/roles?orgId=<selectedId>, which causes the Server Component page
 * to re-render with the new org's role list.
 *
 * Stage 16 Batch D — F3.
 */
export function OrgPicker({ orgs, selectedOrgId }: OrgPickerProps) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    if (value) {
      router.push(`/controls/roles?orgId=${encodeURIComponent(value)}`);
    } else {
      router.push("/controls/roles");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="org-picker"
        className="text-xs font-bold uppercase tracking-wide text-text-muted"
      >
        Organization
      </label>
      <select
        id="org-picker"
        value={selectedOrgId ?? ""}
        onChange={handleChange}
        className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
      >
        <option value="">— Select an organization —</option>
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name} ({org.slug})
          </option>
        ))}
      </select>
    </div>
  );
}
