/**
 * Update-configuration wizard — DAL (Hotfix 2026-10-01, H-6).
 *
 * Preview: compare a DRAFT project's frozen configSnapshot + Selections to the org's CURRENT component
 * config and active formula set. Apply: in one transaction, write the fixed Selection configs, re-freeze
 * the snapshot, re-pin the formula set and clear the calculation. Floors/Rooms/Partitions are untouched.
 *
 * Tenancy: every read/write is scoped by session.organizationId.
 */
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ownedProjectWhere } from "@/lib/data/ownership";
import type { SessionData } from "@/lib/session";
import { loadConfigSnapshot, type ConfigSnapshot } from "@/lib/config-snapshot";
import { isComponentTypeFullyConfigured } from "@/lib/configurator-gating";
import { checkStructuralCompatibility, describeIncompatibility } from "@/lib/formula-compat";
import { invalidateProjectCalculation, resolveFormulaSetPin } from "@/lib/data/formula-pin";
import { parseFieldsSchema, parseFieldOptionsConfig } from "@/lib/parse-field-config";
import type { FormulaSetBody } from "@/lib/summary/types";
import {
  diffConfigs,
  validateSelectionConfig,
  type ConfigUpdatePreview,
  type ConfigValue,
  type DiffType,
  type FieldIssue,
  type SelectionConfig,
} from "@/lib/config-update";

export type ConfigUpdateFixes = Record<string, Record<string, string | boolean>>;

function toDiffTypes(snapshot: ConfigSnapshot | null): DiffType[] {
  return (snapshot?.componentTypes ?? []).map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    active: t.active,
    fieldsSchema: parseFieldsSchema(t.fieldsSchema),
    fieldOptionsConfig: parseFieldOptionsConfig(t.fieldOptionsConfig) ?? {},
  }));
}

function readConfig(raw: unknown): SelectionConfig {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as SelectionConfig) : {};
}

function formulaLabel(set: { name: string; version: number | string } | null | undefined): string | null {
  return set ? `${set.name} v${set.version}` : null;
}

/** Evaluate every selection against the new types. Shared by preview and apply. */
function evaluate(
  selections: { id: string; label: string; componentTypeId: string; config: unknown }[],
  newTypes: DiffType[],
  fixes: ConfigUpdateFixes,
) {
  const byId = new Map(newTypes.map((t) => [t.id, t]));
  return selections.map((s) => {
    const type = byId.get(s.componentTypeId);
    const base: SelectionConfig = { ...readConfig(s.config) };
    if (!type) {
      return { sel: s, typeName: "Unknown", cleaned: base, dropped: [], issues: [] as FieldIssue[], blocking: "This component type no longer exists." };
    }
    if (!isComponentTypeFullyConfigured(type.fieldsSchema, type.fieldOptionsConfig)) {
      return {
        sel: s,
        typeName: type.name,
        cleaned: base,
        dropped: [],
        issues: [] as FieldIssue[],
        blocking: `${type.name} is not fully configured — ask your admin to finish its options first.`,
      };
    }
    // Overlay the user's fixes (only for keys that are real fields) before validating.
    const overlay: SelectionConfig = { ...base };
    const fix = fixes[s.id] ?? {};
    const fieldKeys = new Set(type.fieldsSchema.map((f) => f.key));
    for (const [k, v] of Object.entries(fix)) if (fieldKeys.has(k)) overlay[k] = v as ConfigValue;
    const check = validateSelectionConfig(type.fieldsSchema, type.fieldOptionsConfig, overlay);
    return { sel: s, typeName: type.name, cleaned: check.cleaned, dropped: check.dropped, issues: check.issues, blocking: null as string | null };
  });
}

export async function getConfigUpdatePreview(
  session: SessionData,
  projectId: string,
): Promise<ConfigUpdatePreview | null | { notDraft: true }> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...ownedProjectWhere(session) },
    select: {
      id: true,
      status: true,
      configSnapshot: true,
      formulaSetId: true,
      formulaSet: { select: { name: true, version: true } },
    },
  });
  if (!project) return null;
  if (project.status !== "DRAFT") return { notDraft: true };

  const [newSnapshot, selections, org] = await Promise.all([
    loadConfigSnapshot(prisma, session.organizationId),
    prisma.selection.findMany({
      where: { projectId, organizationId: session.organizationId },
      orderBy: { orderIndex: "asc" },
      select: { id: true, label: true, componentTypeId: true, config: true },
    }),
    prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: { activeFormulaSet: { select: { id: true, name: true, version: true, body: true } } },
    }),
  ]);

  const oldTypes = toDiffTypes(project.configSnapshot as unknown as ConfigSnapshot | null);
  const newTypes = toDiffTypes(newSnapshot);
  const changes = diffConfigs(oldTypes, newTypes);

  const active = org?.activeFormulaSet ?? null;
  let problem: string | null = null;
  if (!active) {
    problem = "Your organization has no active formula set assigned.";
  } else {
    const compat = checkStructuralCompatibility(active.body as unknown as FormulaSetBody, newSnapshot);
    if (!compat.ok) problem = describeIncompatibility(compat, active);
  }
  const formulaChanged = (active?.id ?? null) !== project.formulaSetId;

  const rows = evaluate(selections, newTypes, {});
  const affected = rows.filter((r) => r.dropped.length || r.issues.length || r.blocking);
  const typeMap: ConfigUpdatePreview["types"] = {};
  for (const r of affected) {
    const t = newTypes.find((x) => x.id === r.sel.componentTypeId);
    if (t) typeMap[t.id] = { name: t.name, fieldsSchema: t.fieldsSchema, fieldOptionsConfig: t.fieldOptionsConfig };
  }

  return {
    needsUpdate: changes.length > 0 || formulaChanged || affected.length > 0,
    changes,
    formula: {
      changed: formulaChanged,
      from: formulaLabel(project.formulaSet),
      to: formulaLabel(active),
      problem,
    },
    types: typeMap,
    selections: affected.map((r) => ({
      id: r.sel.id,
      label: r.sel.label,
      typeId: r.sel.componentTypeId,
      typeName: r.typeName,
      config: readConfig(r.sel.config),
      dropped: r.dropped,
      issues: r.issues,
      blocking: r.blocking,
    })),
    totalSelections: selections.length,
  };
}

export type ApplyConfigUpdateResult =
  | null
  | { notDraft: true }
  | { invalid: { id: string; label: string; reason: string }[] }
  | { ok: true; updatedSelections: number };

export async function applyConfigUpdate(
  session: SessionData,
  projectId: string,
  fixes: ConfigUpdateFixes,
): Promise<ApplyConfigUpdateResult> {
  return prisma.$transaction(async (tx) => {
    // Existence + DRAFT re-checked inside the tx (same TOCTOU reasoning as resetProject).
    const project = await tx.project.findFirst({
      where: { id: projectId, ...ownedProjectWhere(session) },
      select: { id: true, status: true },
    });
    if (!project) return null;
    if (project.status !== "DRAFT") return { notDraft: true as const };

    const newSnapshot = await loadConfigSnapshot(tx, session.organizationId);
    const newTypes = toDiffTypes(newSnapshot);
    const selections = await tx.selection.findMany({
      where: { projectId, organizationId: session.organizationId },
      select: { id: true, label: true, componentTypeId: true, config: true },
    });

    // Server-side re-validation of every FINAL config — the client's choices are not trusted.
    const rows = evaluate(selections, newTypes, fixes);
    const invalid = rows
      .filter((r) => r.blocking || r.issues.length)
      .map((r) => ({
        id: r.sel.id,
        label: r.sel.label,
        reason: r.blocking ?? `Still needs: ${r.issues.map((i) => i.label).join(", ")}`,
      }));
    if (invalid.length) return { invalid };

    let updated = 0;
    for (const r of rows) {
      const before = JSON.stringify(readConfig(r.sel.config));
      if (JSON.stringify(r.cleaned) === before) continue;
      await tx.selection.update({
        where: { id: r.sel.id },
        select: { id: true },
        data: { config: r.cleaned as Prisma.InputJsonValue },
      });
      updated++;
    }

    const formulaSetId = await resolveFormulaSetPin(tx, session.organizationId, newSnapshot);
    await tx.project.update({
      where: { id: projectId },
      select: { id: true },
      data: { configSnapshot: newSnapshot as unknown as Prisma.InputJsonValue, formulaSetId },
    });
    await invalidateProjectCalculation(tx, projectId);
    return { ok: true as const, updatedSelections: updated };
  });
}
