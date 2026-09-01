// superadmin-only — intentionally cross-org
// This file belongs to the SuperAdmin data-access layer (lib/data/superadmin/).
// Functions here INTENTIONALLY omit organizationId filters — they operate across all orgs.
// This is the only directory in lib/data/ where cross-org queries are permitted.
// See Stage 16 architecture rule 1 in profile.md.

import { prisma } from "@/lib/prisma";

/**
 * List all organizations with suspension status. Cross-org by design.
 * Used by the SuperAdmin console org list (/controls/orgs).
 *
 * superadmin-only — intentionally cross-org
 */
export async function listAllOrganizations() {
  // superadmin-only — intentionally cross-org
  return prisma.organization.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      isSuspended: true,
      createdAt: true,
    },
  });
}
