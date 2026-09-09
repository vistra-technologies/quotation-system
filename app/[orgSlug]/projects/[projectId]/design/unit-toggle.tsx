"use client";

import { useUnit, type LengthUnit } from "./unit-context";

const UNITS: LengthUnit[] = ["mm", "in", "m"];

/**
 * mm / in / m pill toggle — mirrors design-step-poc.html's `#unitToggle`.
 * Mounted in the Design page's own header row (not the shared wizard
 * breadcrumb, which every wizard step reuses — see plan-item7.md "what
 * genuinely can't be exactly the mockup").
 */
export function UnitToggle() {
  const { unit, setUnit } = useUnit();

  return (
    <div className="flex gap-0.5 rounded-pill bg-primary-softer p-1">
      {UNITS.map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => setUnit(u)}
          aria-pressed={u === unit}
          className={
            u === unit
              ? "rounded-pill bg-primary px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-text-on-primary"
              : "rounded-pill px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-text-muted hover:text-text-heading"
          }
        >
          {u}
        </button>
      ))}
    </div>
  );
}
