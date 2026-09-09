"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type LengthUnit = "mm" | "in" | "m";

const MM_PER_IN = 25.4;

interface UnitContextValue {
  unit: LengthUnit;
  setUnit: (unit: LengthUnit) => void;
  /** Canonical mm -> the current display unit, rounded per unit (mirrors the mockup's toDisplay). */
  toDisplay: (mm: number) => number;
  /** A value typed in the current display unit -> canonical mm (mirrors the mockup's fromDisplay). */
  fromDisplay: (value: number) => number;
  /** Formatted "<value> <unit>" string (mirrors the mockup's formatLen). */
  formatLen: (mm: number) => string;
}

const UnitContext = createContext<UnitContextValue | null>(null);

/**
 * Presentation-only unit context — mirrors design-step-poc.html's
 * `toDisplay`/`fromDisplay`/`formatLen` functions. Canonical storage is
 * always millimetres (matches the real backend's integer-mm columns); the
 * selected unit only affects what's shown/typed in the UI. No backend, no
 * persistence — resets to "mm" on reload, same as the mockup's own
 * in-memory `displayUnit`.
 */
export function UnitProvider({ children }: { children: ReactNode }) {
  const [unit, setUnit] = useState<LengthUnit>("mm");

  const value = useMemo<UnitContextValue>(() => {
    const toDisplay = (mm: number): number => {
      if (unit === "in") return Math.round((mm / MM_PER_IN) * 10) / 10;
      if (unit === "m") return Math.round(mm / 10) / 100;
      return Math.round(mm);
    };
    const fromDisplay = (value: number): number => {
      if (unit === "in") return value * MM_PER_IN;
      if (unit === "m") return value * 1000;
      return value;
    };
    const formatLen = (mm: number): string => `${toDisplay(mm)} ${unit}`;
    return { unit, setUnit, toDisplay, fromDisplay, formatLen };
  }, [unit]);

  return <UnitContext.Provider value={value}>{children}</UnitContext.Provider>;
}

export function useUnit(): UnitContextValue {
  const ctx = useContext(UnitContext);
  if (!ctx) {
    throw new Error("useUnit() must be used within a <UnitProvider>.");
  }
  return ctx;
}
