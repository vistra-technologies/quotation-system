/**
 * Read model for the SuperAdmin audit log (hotfix 2026-10-02): turns the stored free-form action code
 * into the display triple the page shows — Action badge (INSERT / UPDATE / DELETE), Item, and a one-line
 * summary — and derives the org / entity-label snapshots the writer stores. Pure module: no I/O, safe
 * to import from client components, unit-tested in tests/unit/superadmin-audit-view.test.ts.
 */

export const AUDIT_VERBS = ["INSERT", "UPDATE", "DELETE"] as const;
export type AuditVerb = (typeof AUDIT_VERBS)[number];

/** `targetType` (as stored) → the Item name shown in the table. */
export const ITEM_BY_TARGET_TYPE: Record<string, string> = {
  Organization: "Organization",
  User: "User",
  Role: "Role",
  FormulaSet: "Formula set",
  ComponentType: "Component type",
  SuperAdmin: "SuperAdmin",
};

export function itemForTargetType(targetType: string): string {
  return ITEM_BY_TARGET_TYPE[targetType] ?? targetType;
}

/** Reverse lookup for the Item filter: Item name → stored targetType(s). */
export function targetTypesForItem(item: string): string[] {
  return Object.entries(ITEM_BY_TARGET_TYPE)
    .filter(([, name]) => name === item)
    .map(([targetType]) => targetType);
}

/** INSERT: creates and new versions; DELETE: deletes; everything else (incl. unknown codes) is UPDATE. */
export function verbForAction(action: string): AuditVerb {
  const op = action.split(".")[1] ?? "";
  if (op === "create" || op === "newVersion") return "INSERT";
  if (op === "delete") return "DELETE";
  return "UPDATE";
}

/** Stored actions that map to a verb — used by the API's verb filter (so it stays in SQL). */
export function actionsForVerb(verb: AuditVerb, knownActions: string[]): string[] {
  return knownActions.filter((a) => verbForAction(a) === verb);
}

/** Every action code the app writes today. Unknown codes written later still list (as UPDATE). */
export const KNOWN_ACTIONS = [
  "org.create", "org.update", "org.suspend", "org.reactivate", "org.delete",
  "user.create", "user.update", "user.delete",
  "role.create", "role.rename",
  "permission.assign", "permission.revoke",
  "componentType.create", "componentType.update", "componentType.reorder", "componentType.delete",
  "formulaSet.create", "formulaSet.update", "formulaSet.newVersion", "formulaSet.delete",
  "superadmin.create", "superadmin.password_change", "superadmin.delete",
] as const;

type Meta = Record<string, unknown> | null | undefined;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** The org an audit row belongs to: the target itself for Organization rows, else metadata. */
export function deriveOrganizationId(targetType: string, targetId: string, metadata: Meta): string | null {
  if (targetType === "Organization") return targetId;
  return str(metadata?.organizationId) ?? str(metadata?.orgId);
}

/** Best entity name available from metadata alone (used when the target row is already gone). */
export function labelFromMetadata(metadata: Meta): string | null {
  if (!metadata) return null;
  const name = str(metadata.name);
  const version = metadata.version;
  return (
    str(metadata.deletedUsername) ??
    str(metadata.username) ??
    str(metadata.slug) ??
    str(metadata.newName) ??
    str(metadata.code) ??
    (name && (typeof version === "number" || typeof version === "string") ? `${name} v${version}` : null) ??
    name
  );
}

function list(v: unknown): string | null {
  return Array.isArray(v) && v.length ? v.map(String).join(", ") : null;
}

const FIELD_NAMES: Record<string, string> = {
  roleId: "role",
  firstName: "first name",
  lastName: "last name",
  profileEmail: "email",
  newPassword: "password",
  fieldsSchema: "field schema",
  formulaSetId: "formula set",
  active: "status",
};
const prettyField = (f: string) => FIELD_NAMES[f] ?? f;

/** One plain-English line under the entity name. Never includes secrets. */
export function summarizeAction(action: string, metadata: Meta): string {
  const m = metadata ?? {};
  switch (action) {
    case "org.create": return "New organization";
    case "org.suspend": return "Suspended";
    case "org.reactivate": return "Reactivated";
    case "org.delete": {
      const n = m.usersDeleted;
      return typeof n === "number" ? `Deleted with ${n} user${n === 1 ? "" : "s"}` : "Organization deleted";
    }
    case "org.update": {
      const parts = [
        str(m.name) ? "name" : null,
        m.formulaSetId !== undefined ? "formula set" : null,
        m.userLimit !== undefined ? "user limit" : null,
      ].filter(Boolean);
      return parts.length ? `Changed ${parts.join(", ")}` : "Updated";
    }
    case "user.create": return "New user";
    case "user.update": {
      const f = Array.isArray(m.changedFields) ? (m.changedFields as unknown[]).map((x) => prettyField(String(x))) : [];
      return f.length ? `Changed ${f.join(", ")}` : "Updated";
    }
    case "user.delete": return "User deleted";
    case "role.create": return "New role";
    case "role.rename": return str(m.newName) ? `Renamed to ${str(m.newName)}` : "Renamed";
    case "permission.assign": return "Permission added";
    case "permission.revoke": return "Permission removed";
    case "componentType.create": return "New component type";
    case "componentType.update": {
      const f = Array.isArray(m.changedFields) ? (m.changedFields as unknown[]).map((x) => prettyField(String(x))) : [];
      return f.length ? `Changed ${f.join(", ")}` : "Updated";
    }
    case "componentType.reorder": return "Reordered";
    case "componentType.delete": return "Component type deleted";
    case "formulaSet.create": return "New formula set";
    case "formulaSet.newVersion": return "New version";
    case "formulaSet.update": return "Updated";
    case "formulaSet.delete": return "Formula set deleted";
    case "superadmin.create": return "New SuperAdmin account";
    case "superadmin.password_change": {
      const n = m.sessionsRevoked;
      return typeof n === "number" && n > 0 ? `Password changed · ${n} session${n === 1 ? "" : "s"} signed out` : "Password changed";
    }
    case "superadmin.delete": return "SuperAdmin account deleted";
    default: return list(m.changedFields) ? `Changed ${list(m.changedFields)}` : action;
  }
}

// ── Filter parsing (shared by the API route and the page) ───────────────────────────────────────

export type AuditScope = "all" | "platform" | "org";

export interface AuditFilters {
  scope: AuditScope;
  orgId: string | null;
  by: string | null;
  verb: AuditVerb | null;
  item: string | null;
  from: string | null; // YYYY-MM-DD, inclusive
  to: string | null; // YYYY-MM-DD, inclusive
  /** Exclude rows whose actor snapshot is TEST_ACCOUNT_USERNAME (query: hideTest=1). */
  hideTest: boolean;
  page: number;
  pageSize: number;
}

/** Fix round 2: the SuperAdmin whose activity the "Hide testeraccount activity" filter excludes. */
export const TEST_ACCOUNT_USERNAME = "testeraccount";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Returns parsed filters, or `{ error }` describing the first invalid value. Empty values are "unset". */
export function parseAuditFilters(
  get: (key: string) => string | null | undefined,
): { ok: true; filters: AuditFilters } | { ok: false; error: string } {
  const val = (k: string) => {
    const v = get(k);
    return v && v.trim() ? v.trim() : null;
  };

  const scope = (val("scope") ?? "all") as string;
  if (scope !== "all" && scope !== "platform" && scope !== "org") {
    return { ok: false, error: "scope must be one of: all, platform, org" };
  }
  const orgId = val("orgId");
  if (orgId && scope !== "org") return { ok: false, error: "orgId can only be used with scope=org" };

  const verb = val("verb");
  if (verb && !(AUDIT_VERBS as readonly string[]).includes(verb)) {
    return { ok: false, error: "verb must be one of: INSERT, UPDATE, DELETE" };
  }
  const item = val("item");
  if (item && targetTypesForItem(item).length === 0) {
    return { ok: false, error: `item must be one of: ${Object.values(ITEM_BY_TARGET_TYPE).join(", ")}` };
  }
  const from = val("from");
  const to = val("to");
  if (from && !validDate(from)) return { ok: false, error: "from must be a valid date (YYYY-MM-DD)" };
  if (to && !validDate(to)) return { ok: false, error: "to must be a valid date (YYYY-MM-DD)" };
  if (from && to && from > to) return { ok: false, error: "from must not be after to" };

  const hideTestRaw = val("hideTest");
  if (hideTestRaw !== null && hideTestRaw !== "1" && hideTestRaw !== "0") {
    return { ok: false, error: "hideTest must be 1 or 0" };
  }

  const pageRaw = val("page");
  const page = pageRaw === null ? 1 : Number(pageRaw);
  if (!Number.isInteger(page) || page < 1) return { ok: false, error: "page must be a positive integer" };
  const sizeRaw = val("pageSize");
  const pageSize = sizeRaw === null ? DEFAULT_PAGE_SIZE : Number(sizeRaw);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    return { ok: false, error: `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}` };
  }

  return {
    ok: true,
    filters: { scope: scope as AuditScope, orgId, by: val("by"), verb: verb as AuditVerb | null, item, from, to, hideTest: hideTestRaw === "1", page, pageSize },
  };
}
