"use client";

import { useRouter } from "next/navigation";
import { SelectField } from "@/components/select-field";

interface OrgPickerProps {
  orgs: Array<{ id: string; name: string; slug: string }>;
  selectedOrgId: string | null;
  /** Base path for org-picker navigation. Defaults to "/controls/roles". */
  basePath?: string;
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
export function OrgPicker({ orgs, selectedOrgId, basePath = "/controls/roles" }: OrgPickerProps) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    if (value) {
      router.push(`${basePath}?orgId=${encodeURIComponent(value)}`);
    } else {
      router.push(basePath);
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
      <SelectField
        id="org-picker"
        value={selectedOrgId ?? ""}
        onChange={handleChange}
        placeholder="Select organization"
      >
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name} ({org.slug})
          </option>
        ))}
      </SelectField>
    </div>
  );
}
