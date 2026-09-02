/**
 * Default role definitions seeded into every new organization.
 *
 * This is the single source of truth for the 4-role default set —
 * imported by both prisma/seed.ts (for dev/preview bootstrapping) and
 * lib/data/superadmin/orgs.ts (for SuperAdmin-initiated org creation).
 *
 * Source: design-docs/02-roles-and-journeys.md
 * Stage 15 Batch G (U3): isInternalRole=true for Admin + Company Member (internal
 * staff who may omit External Company). External roles default to false.
 */

export interface RoleDef {
  name: string;
  description: string;
  isInternalRole: boolean;
  /** Permission codes that must be linked to this role. */
  permissions: string[];
}

export const DEFAULT_ROLE_DEFS: readonly RoleDef[] = [
  {
    name: "Admin",
    description: "Full organizational administration",
    isInternalRole: true,
    permissions: [
      "MANAGE_USERS",
      "MANAGE_FEATURES",
      "VIEW_ALL_DATA",
      "MANAGE_PRICING",
      "APPLY_DISCOUNT",
    ],
  },
  {
    name: "Company Member",
    description: "Internal staff with pricing access",
    isInternalRole: true,
    permissions: ["VIEW_ALL_DATA", "MANAGE_PRICING", "APPLY_DISCOUNT"],
  },
  {
    name: "Distributor",
    description: "External distributor company user",
    isInternalRole: false,
    permissions: ["DESIGN", "QUOTE", "ORDER"],
  },
  {
    name: "Architectural Firm",
    description: "External architectural firm user",
    isInternalRole: false,
    permissions: ["DESIGN"],
  },
] as const;
