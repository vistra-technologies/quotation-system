import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { auth } from "@/lib/auth";
import { toAuthEmail, toPlatformAuthEmail } from "@/lib/auth-utils";
import { DEFAULT_ROLE_DEFS } from "@/lib/org-role-defaults";
import { COMPONENT_TYPE_DEFS, SEEDED_CATALOG_CATEGORY_NAME } from "@/lib/component-catalog-seed";

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
// Imported from lib/org-role-defaults.ts — shared with the SuperAdmin create-org path.
// See DEFAULT_ROLE_DEFS for the canonical list and its source documentation.
const roleDefs = DEFAULT_ROLE_DEFS;

async function main() {
  // ── 0a. One-time cleanup: purge E2E test artifacts ─────────────────────────
  // E2E specs previously created timestamped permission codes (E2E_PERM_*)
  // that were never cleaned up, causing them to appear in the admin UI.
  // This deleteMany runs on every seed invocation (idempotent — no-op when
  // already clean). Stage 15 Batch G (U6).
  const purged = await prisma.permission.deleteMany({
    where: { code: { startsWith: "E2E_PERM_" } },
  });
  if (purged.count > 0) {
    console.log(`Purged ${purged.count} E2E_PERM_* test permission(s) from the catalog`);
  }

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
        update: { description: roleDef.description, isInternalRole: roleDef.isInternalRole },
        create: {
          organizationId: org.id,
          name: roleDef.name,
          description: roleDef.description,
          isInternalRole: roleDef.isInternalRole,
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
        firstName: "Admin",
        lastName: "User",
        externalCompanyId: undefined as string | undefined,
      },
      {
        username: "member",
        roleName: "Company Member",
        firstName: "Member",
        lastName: "User",
        externalCompanyId: undefined as string | undefined,
      },
      {
        username: "distributor",
        roleName: "Distributor",
        firstName: "Distributor",
        lastName: "User",
        externalCompanyId: distCompany.id,
      },
      {
        username: "architect",
        roleName: "Architectural Firm",
        firstName: "Architect",
        lastName: "User",
        externalCompanyId: archCompany.id,
      },
    ];

    for (const slot of userSlots) {
      const synthEmail = toAuthEmail(slot.username, org.slug);

      // Idempotent: update name if user already exists (fixes stale displayName-style
      // values that pre-date the firstName/lastName split), then skip creation.
      const existing = await prisma.user.findUnique({
        where: { email: synthEmail },
        select: { id: true, name: true },
      });
      if (existing) {
        const expectedName = `${slot.firstName} ${slot.lastName}`;
        if (existing.name !== expectedName) {
          await prisma.user.update({
            where: { id: existing.id },
            data: { name: expectedName },
          });
        }
        continue;
      }

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
            // better-auth core display name — always firstName + lastName (same as createUser in lib/data/users.ts)
            name: `${slot.firstName} ${slot.lastName}`,
            organizationId: org.id,
            username: slot.username,
            firstName: slot.firstName,
            lastName: slot.lastName,
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

  // ── 4. ComponentCategories + ComponentTypes (idempotent by organizationId + code) ──
  // Definitions imported from lib/component-catalog-seed.ts — shared with the
  // createOrganizationWithDefaults() org-creation path so both callers use the
  // same source of truth. The upsert pattern here is intentional: this seed script
  // re-runs against pre-existing orgs and must be idempotent. The org-creation path
  // uses plain .create() because it only ever runs once (at org creation time).
  for (const org of allOrgs) {
    const glassPartitions = await prisma.componentCategory.upsert({
      where: {
        organizationId_name: { organizationId: org.id, name: SEEDED_CATALOG_CATEGORY_NAME },
      },
      update: {},
      create: { organizationId: org.id, name: SEEDED_CATALOG_CATEGORY_NAME },
    });

    for (const def of COMPONENT_TYPE_DEFS) {
      // Upsert by organizationId + code so re-running the seed updates existing rows
      // (consistent with the upsert pattern used for all other seeded entities).
      await prisma.componentType.upsert({
        where: {
          organizationId_code: { organizationId: org.id, code: def.code },
        },
        update: {
          name: def.name,
          categoryId: glassPartitions.id,
          fieldsSchema: def.fieldsSchema,
        },
        create: {
          organizationId: org.id,
          code: def.code,
          name: def.name,
          categoryId: glassPartitions.id,
          fieldsSchema: def.fieldsSchema,
          active: true,
        },
      });
    }
  }

  const totalComponentCategories = await prisma.componentCategory.count();
  const totalComponentTypes = await prisma.componentType.count();
  console.log(
    `ComponentCategories: ${totalComponentCategories}  (1×${allOrgs.length}=${allOrgs.length} expected)`,
  );
  console.log(
    `ComponentTypes:     ${totalComponentTypes}  (${COMPONENT_TYPE_DEFS.length}×${allOrgs.length}=${COMPONENT_TYPE_DEFS.length * allOrgs.length} expected)`,
  );

  // ── 5. Catalog items and prices ─────────────────────────────────────────────
  // Representative items covering all categories.
  // PLACEHOLDER — replace with real client data before handover
  const catalogItemDefs = [
    {
      category: "WALL_TYPE",
      code: "WT-001",
      name: "Standard Glass Wall",
      uom: "M2",
      attributes: {}, // PLACEHOLDER — replace with real client data before handover
    },
    {
      category: "GLASS",
      code: "GL-001",
      name: "Clear Float 8mm",
      uom: "M2",
      attributes: { thicknessMm: 8 }, // PLACEHOLDER — replace with real client data before handover
    },
    {
      category: "DOOR_TYPE",
      code: "DT-001",
      name: "Single Swing Door",
      uom: "LEAF",
      attributes: {}, // PLACEHOLDER — replace with real client data before handover
    },
    {
      category: "PROFILE_STOP",
      code: "PS-001",
      name: "Aluminium U-Profile",
      uom: "M",
      attributes: {}, // PLACEHOLDER — replace with real client data before handover
    },
    {
      category: "FRAME",
      code: "FR-001",
      name: "Standard Frame",
      uom: "SET",
      attributes: {}, // PLACEHOLDER — replace with real client data before handover
    },
    {
      category: "HINGE",
      code: "HG-001",
      name: "Glass-to-Glass Hinge",
      uom: "PC",
      attributes: {}, // PLACEHOLDER — replace with real client data before handover
    },
    {
      category: "LOCKBOX",
      code: "LB-001",
      name: "Standard Lock Box",
      uom: "PC",
      attributes: {}, // PLACEHOLDER — replace with real client data before handover
    },
    {
      category: "HANDLE",
      code: "HA-001",
      name: "D-Handle",
      uom: "PAIR",
      attributes: {}, // PLACEHOLDER — replace with real client data before handover
    },
    {
      category: "SEAL",
      code: "SL-001",
      name: "Bottom Seal",
      uom: "M",
      attributes: {}, // PLACEHOLDER — replace with real client data before handover
    },
    {
      category: "RUBBER",
      code: "RB-001",
      name: "Edge Rubber Strip",
      uom: "M",
      attributes: {}, // PLACEHOLDER — replace with real client data before handover
    },
    {
      category: "FITTING",
      code: "FT-001",
      name: "Panel Fitting Set",
      uom: "SET",
      attributes: {}, // PLACEHOLDER — replace with real client data before handover
    },
    {
      category: "SCREW",
      code: "SC-001",
      name: "M6 Bolt Set",
      uom: "SET",
      attributes: {}, // PLACEHOLDER — replace with real client data before handover
    },
  ];

  // Placeholder prices per item (two currencies).
  // PLACEHOLDER — replace with real client data before handover
  const priceDefs = [
    { currency: "AED", amount: "100.00" }, // PLACEHOLDER — replace with real client data before handover
    { currency: "USD", amount: "27.00" }, // PLACEHOLDER — replace with real client data before handover
  ];

  for (const org of allOrgs) {
    for (const def of catalogItemDefs) {
      const item = await prisma.catalogItem.upsert({
        where: {
          organizationId_code: { organizationId: org.id, code: def.code },
        },
        update: { name: def.name, unitOfMeasure: def.uom, attributes: def.attributes },
        create: {
          organizationId: org.id,
          category: def.category,
          code: def.code,
          name: def.name,
          unitOfMeasure: def.uom,
          attributes: def.attributes,
          active: true,
        },
      });

      for (const p of priceDefs) {
        await prisma.itemPrice.upsert({
          where: {
            catalogItemId_currency: {
              catalogItemId: item.id,
              currency: p.currency,
            },
          },
          update: { price: p.amount, organizationId: org.id },
          create: {
            organizationId: org.id,
            catalogItemId: item.id,
            currency: p.currency,
            price: p.amount, // PLACEHOLDER — replace with real client data before handover
          },
        });
      }
    }
  }
  console.log(`CatalogItems + ItemPrices seeded for ${allOrgs.length} orgs`);

  // ── 6. SuperAdmin bootstrap accounts ────────────────────────────────────────
  // Reads SUPERADMIN_DEVADMIN_PASSWORD, SUPERADMIN_ISHAN_PASSWORD,
  // SUPERADMIN_SHAJI_PASSWORD from env. If ANY are missing, skips the entire
  // SuperAdmin seed step with a warning — the rest of the seed still completes.
  // Never logs plaintext passwords.
  //
  // The three env vars must be set in Vercel (Production + Preview + Development)
  // before this seed step can run on any deployed environment.
  // See profile.md "Ops prerequisite" section.
  const superAdminDefs = [
    { username: "devadmin", envVar: "SUPERADMIN_DEVADMIN_PASSWORD" },
    { username: "ishan",    envVar: "SUPERADMIN_ISHAN_PASSWORD" },
    { username: "shaji",    envVar: "SUPERADMIN_SHAJI_PASSWORD" },
  ];

  const missingVars = superAdminDefs.filter((d) => !process.env[d.envVar]);
  if (missingVars.length > 0) {
    console.warn(
      `\nSuperAdmin seed SKIPPED — missing env vars: ${missingVars.map((d) => d.envVar).join(", ")}`,
    );
    console.warn("Set those env vars in Vercel (Production + Preview + Development) and re-seed.");
  } else {
    let superAdminCount = 0;
    for (const def of superAdminDefs) {
      const plaintext = process.env[def.envVar]!; // asserted non-null above
      const hash = await authCtx.password.hash(plaintext);
      const email = toPlatformAuthEmail(def.username);

      await prisma.superAdmin.upsert({
        where: { username: def.username },
        update: { passwordHash: hash, email },
        create: {
          username: def.username,
          email,
          passwordHash: hash,
        },
      });
      superAdminCount++;
    }
    console.log(`SuperAdmins: ${superAdminCount} (3 expected)`);
  }

  // ── 7. Summary ──────────────────────────────────────────────────────────────
  const totalRoles = await prisma.role.count();
  const totalCompanies = await prisma.externalCompany.count();
  const totalUsers = await prisma.user.count();
  const totalCatalogItems = await prisma.catalogItem.count();
  const totalItemPrices = await prisma.itemPrice.count();
  const totalComponentTypesCount = await prisma.componentType.count();

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
  console.log(
    `Catalog items:      ${totalCatalogItems}  (${catalogItemDefs.length}×${allOrgs.length}=${catalogItemDefs.length * allOrgs.length} expected)`,
  );
  console.log(
    `Item prices:        ${totalItemPrices}  (${priceDefs.length * catalogItemDefs.length}×${allOrgs.length}=${priceDefs.length * catalogItemDefs.length * allOrgs.length} expected)`,
  );
  console.log(
    `Component types:    ${totalComponentTypesCount}  (${COMPONENT_TYPE_DEFS.length}×${allOrgs.length}=${COMPONENT_TYPE_DEFS.length * allOrgs.length} expected)`,
  );
  const totalSuperAdmins = await prisma.superAdmin.count();
  console.log(`SuperAdmins:        ${totalSuperAdmins}  (3 expected when env vars are set)`);
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
