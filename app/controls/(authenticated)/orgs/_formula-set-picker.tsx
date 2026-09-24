"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

/**
 * A single formula set item as returned by GET /api/v1/superadmin/formula-sets.
 * Dates are serialised to strings when crossing the server→client boundary.
 */
export interface FormulaSetPickerItem {
  id: string;
  name: string;
  version: number;
  locked: boolean;
}

interface FormulaSetPickerProps {
  formulaSets: FormulaSetPickerItem[];
  /** The formula set ID that should be pre-selected (edit form). Undefined = no pre-selection. */
  initialSetId?: string;
  /** Hint text shown below the picker. Defaults vary between create and edit usage. */
  hint?: string;
}

const SELECT_CLS =
  "w-full rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)] disabled:opacity-50 disabled:cursor-not-allowed";
const PLACEHOLDER_CLS = SELECT_CLS + " text-text-placeholder";

/**
 * Two-step formula-set picker (Batch 5 / S25-3).
 *
 * Step 1: pick a name from a grouped name select (distinct names, alphabetical).
 * Step 2: the version select is populated with that name's versions, newest first,
 *          with locked versions labeled "(locked)".
 *
 * The selected formula set ID is stored in a hidden input named "formulaSetId"
 * so the surrounding form action can read it via FormData.
 *
 * Pure client-side grouping via useMemo — no extra API calls.
 */
export function FormulaSetPicker({ formulaSets, initialSetId, hint }: FormulaSetPickerProps) {
  // Group flat list by name, sorted by version descending within each group.
  const grouped = useMemo(() => {
    const map = new Map<string, FormulaSetPickerItem[]>();
    for (const fs of formulaSets) {
      if (!map.has(fs.name)) map.set(fs.name, []);
      map.get(fs.name)!.push(fs);
    }
    // Sort each group newest-first.
    for (const [, versions] of map) {
      versions.sort((a, b) => b.version - a.version);
    }
    // Return names in alphabetical order.
    return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }, [formulaSets]);

  // Derive the initial name from the initialSetId.
  const initialName = useMemo(() => {
    if (!initialSetId) return "";
    const found = formulaSets.find((fs) => fs.id === initialSetId);
    return found?.name ?? "";
  }, [formulaSets, initialSetId]);

  const [selectedName, setSelectedName] = useState(initialName);
  const [selectedId, setSelectedId] = useState(initialSetId ?? "");

  const versionsForName = selectedName ? (grouped.get(selectedName) ?? []) : [];

  function handleNameChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newName = e.target.value;
    setSelectedName(newName);
    // Auto-select the first (newest) version for the new name.
    const versions = grouped.get(newName) ?? [];
    setSelectedId(versions[0]?.id ?? "");
  }

  function handleVersionChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedId(e.target.value);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-text-muted">
          Formula set
        </span>
        <Link
          href="/controls/formula-sets"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-bold text-primary hover:text-primary-dark hover:underline"
        >
          Manage formula sets ↗
        </Link>
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-2.5">
        {/* Name select */}
        <select
          value={selectedName}
          onChange={handleNameChange}
          className={selectedName ? SELECT_CLS : PLACEHOLDER_CLS}
          required
        >
          <option value="" disabled>
            Select a name…
          </option>
          {[...grouped.keys()].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        {/* Version select */}
        <select
          value={selectedId}
          onChange={handleVersionChange}
          disabled={versionsForName.length === 0}
          className={selectedId ? SELECT_CLS : PLACEHOLDER_CLS}
          required
        >
          {versionsForName.length === 0 ? (
            <option value="" disabled>
              Version…
            </option>
          ) : (
            versionsForName.map((fs) => (
              <option key={fs.id} value={fs.id}>
                {`v${fs.version}${fs.locked ? "  (locked)" : ""}`}
              </option>
            ))
          )}
        </select>
      </div>

      {/* Hidden input carries the selected ID into the form action */}
      <input type="hidden" name="formulaSetId" value={selectedId} />

      {hint && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  );
}
