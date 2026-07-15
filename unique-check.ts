import "dotenv/config";
import { PrismaClient } from "./app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  // Try to create a duplicate username in same org (should fail)
  const org = await prisma.organization.findUnique({ where: { slug: "acme-glass" } });
  if (!org) throw new Error("acme-glass not found");
  
  const role = await prisma.role.findFirst({ where: { organizationId: org.id, name: "Admin" } });
  if (!role) throw new Error("Role not found");
  
  try {
    await prisma.user.create({
      data: {
        email: "test-duplicate@acme-glass.internal", 
        name: "Test Dup",
        organizationId: org.id,
        username: "admin", // duplicate username in same org
        active: true,
        roleId: role.id,
      }
    });
    console.log("ERROR: Duplicate username was allowed - constraint NOT enforced!");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) {
      console.log("OK: Unique constraint correctly prevented duplicate username in same org");
    } else {
      console.log("Error:", msg.slice(0, 200));
    }
  }
  
  // Confirm admin exists in each org independently (same username, different orgs)
  const admins = await prisma.user.findMany({ 
    where: { username: "admin" },
    include: { organization: { select: { slug: true } } }
  });
  console.log(`\nAdmins in each org: ${admins.map(a => a.organization.slug).join(", ")}`);
  console.log(`Count: ${admins.length} (expected 4 - confirms per-org uniqueness)`);
  
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });

