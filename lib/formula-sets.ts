/**
 * The (name) the platform currently activates for every seeded/new org. A single constant so
 * prisma/seed.ts, prisma/backfill-formula-set-pins.ts and createOrganizationWithDefaults()
 * (lib/data/superadmin/orgs.ts) all name the exact same set — kept in lib/ so app runtime code
 * never imports from prisma/ seed scripts.
 */
export const ACTIVE_FORMULA_SET_NAME = "glass-partition-standard";
