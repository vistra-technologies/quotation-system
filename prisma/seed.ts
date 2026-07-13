import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { auth } from "@/lib/auth";
import { toAuthEmail } from "@/lib/auth-utils";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Single seeded password — printed at end so testers know it.
// Users are provisioned directly (not via the public sign-up route, which is
// disabled by disableSignUp: true in lib/auth.ts).  We use better-auth's own
// password hasher so credential login verification continues to work.
const SEED_PASSWORD = "Seed1234!";

// ─── Tenant organizations ────────────────────────────────────────────────────
const organizations = [
  { slug: "vistra", name: "Vistra Partitions" },
  { slug: "acme-glass", name: "Acme Glass Co." },
  { slug: "nordic-walls", name: "Nordic Walls AB" },
  { slug: "clearline", name: "ClearLine Interiors" },
];

// ─── Global permission catalog (8 permissions) ────────────────────────────────
const permissionCatalog = [
  {
    code: "MANAGE_USERS",
    description: "Create, update, and deactivate users within the org",
  },
  {
    code: "MANAGE_FEATURES",
    description: "Toggle feature flags within the org",
  },
  {
    code: "VIEW_ALL_DATA",
    description: "Read all projects, quotations, and pricing in the org",
  },
  { code: "MANAGE_PRICING", description: "Set and update product pricing" },
  { code: "APPLY_DISCOUNT", description: "Apply discounts to quotations" },
  {
    code: "DESIGN",
    description: "Create and update glass-partition designs",
  },
  { code: "QUOTE", description: "Generate and submit quotations" },
  { code: "ORDER", description: "Convert quotations to orders" },
];

// ─── Role definitions with permission matrix ────────────────────────────────
// Source: design-docs/02-roles-and-journeys.md
const roleDefs = [
  {
    name: "Admin",
    description: "Full organizational administration",
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
    permissions: ["VIEW_ALL_DATA", "MANAGE_PRICING", "APPLY_DISCOUNT"],
  },
  {
    name: "Distributor",
    description: "External distributor company user",
    permissions: ["DESIGN", "QUOTE", "ORDER"],
  },
  {
    name: "Architectural Firm",
    description: "External architectural firm user",
    permissions: ["DESIGN"],
  },
];

async function main() {
  // ── 0. Resolve the better-auth password hasher once ────────────────────────
  // auth.$context is a Promise<AuthContext>; password.hash uses the same Scrypt
  // implementation that the sign-in route uses for verification — guaranteeing
  // that seeded credentials work at login.  We do NOT use auth.api.signUpEmail
  // because that route is now disabled (disableSignUp: true in lib/auth.ts).
  const authCtx = await auth.$context;
  const passwordHash = await authCtx.password.hash(SEED_PASSWORD);

  // ── 1. Organizations (idempotent by slug) ───────────────────────────────────
  for (const org of organizations) {
    await prisma.organization.upsert({
      where: { slug: org.slug },
      update: { name: org.name },
      create: org,
    });
  }
  const totalOrgs = await prisma.organization.count();
  console.log(`Organizations: ${totalOrgs}`);

  // ── 2. Global permission catalog (idempotent by code) ───────────────────────
  for (const perm of permissionCatalog) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: { description: perm.description },
      create: perm,
    });
  }
  const totalPerms = await prisma.permission.count();
  console.log(`Permissions: ${totalPerms}`);

  // ── 3. Per-org roles, role-permissions, external companies, users ────────────
  const allOrgs = await prisma.organization.findMany({
    orderBy: { slug: "asc" },
  });

  for (const org of allOrgs) {
    // Upsert 4 roles per org (idempotent by organizationId + name)
    const roleMap: Record<string, string> = {}; // role name → role id

    for (const roleDef of roleDefs) {
      const role = await prisma.role.upsert({
        where: {
          organizationId_name: {
            organizationId: org.id,
            name: roleDef.name,
          },
        },
        update: { description: roleDef.description },
        create: {
          organizationId: org.id,
          name: roleDef.name,
          description: roleDef.description,
        },
      });
      roleMap[roleDef.name] = role.id;

      // Upsert role-permission links (idempotent by composite PK)
      for (const code of roleDef.permissions) {
        const perm = await prisma.permission.findUnique({ where: { code } });
        if (!perm) continue;

        await prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: perm.id,
            },
          },
          update: {},
          create: { roleId: role.id, permissionId: perm.id },
        });
      }
    }

    // Upsert 2 external companies per org (idempotent: check before create)
    let distCompany = await prisma.externalCompany.findFirst({
      where: { organizationId: org.id, type: "DISTRIBUTOR" },
    });
    if (!distCompany) {
      distCompany = await prisma.externalCompany.create({
        data: {
          organizationId: org.id,
          type: "DISTRIBUTOR",
          name: `${org.name} Dist Co`,
        },
      });
    }

    let archCompany = await prisma.externalCompany.findFirst({
      where: { organizationId: org.id, type: "ARCHITECTURAL_FIRM" },
    });
    if (!archCompany) {
      archCompany = await prisma.externalCompany.create({
        data: {
          organizationId: org.id,
          type: "ARCHITECTURAL_FIRM",
          name: `${org.name} Arch Firm`,
        },
      });
    }

    // Seed 4 users per org with direct DB provisioning.
    // D1 guardrail: toAuthEmail() is the only place the synthetic email is built.
    const userSlots = [
      {
        username: "admin",
        roleName: "Admin",
        displayName: `${org.slug} admin`,
        externalCompanyId: undefined as string | undefined,
      },
      {
        username: "member",
        roleName: "Company Member",
        displayName: `${org.slug} member`,
        externalCompanyId: undefined as string | undefined,
      },
      {
        username: "distributor",
        roleName: "Distributor",
        displayName: `${org.slug} distributor`,
        externalCompanyId: distCompany.id,
      },
      {
        username: "architect",
        roleName: "Architectural Firm",
        displayName: `${org.slug} architect`,
        externalCompanyId: archCompany.id,
      },
    ];

    for (const slot of userSlots) {
      const synthEmail = toAuthEmail(slot.username, org.slug);

      // Idempotent: skip if this synthetic email already exists.
      const existing = await prisma.user.findUnique({
        where: { email: synthEmail },
      });
      if (existing) continue;

      const roleId = roleMap[slot.roleName];
      if (!roleId) {
        console.warn(
          `  Role "${slot.roleName}" not found for org ${org.slug} — skipping user ${slot.username}`,
        );
        continue;
      }

      // Create user row and matching account row in a single transaction.
      // If the account create fails after the user create, the transaction rolls
      // back both writes so the next rerun can re-attempt cleanly (no orphaned
      // user row with no credential).  The sign-up route is disabled
      // (disableSignUp: true), so we provision server-side instead.
      // providerId "credential" matches what better-auth's sign-in route looks up.
      await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email: synthEmail,
            emailVerified: false,
            name: slot.displayName,
            organizationId: org.id,
            username: slot.username,
            active: true,
            roleId,
            externalCompanyId: slot.externalCompanyId ?? null,
          },
        });

        await tx.account.create({
          data: {
            userId: newUser.id,
            providerId: "credential",
            accountId: newUser.id,
            password: passwordHash,
          },
        });
      });
    }
  }

  // ── 4. Summary ──────────────────────────────────────────────────────────────
  const totalRoles = await prisma.role.count();
  const totalCompanies = await prisma.externalCompany.count();
  const totalUsers = await prisma.user.count();

  console.log(`\n===== Seed summary =====`);
  console.log(`Organizations:      ${totalOrgs}  (4 expected)`);
  console.log(`Permissions:        ${totalPerms}  (8 expected)`);
  console.log(
    `Roles:              ${totalRoles}  (4×${allOrgs.length}=${4 * allOrgs.length} expected)`,
  );
  console.log(
    `External companies: ${totalCompanies}  (2×${allOrgs.length}=${2 * allOrgs.length} expected)`,
  );
  console.log(
    `Users:              ${totalUsers}  (4×${allOrgs.length}=${4 * allOrgs.length} expected)`,
  );
  console.log(`\nSeeded password: ${SEED_PASSWORD}`);
  console.log(`Login at e.g. http://localhost:3000/acme-glass/login`);
  console.log(`========================`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
