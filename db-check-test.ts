import "dotenv/config";
import { PrismaClient } from "./app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const [orgs, users, perms, roles, companies] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.permission.count(),
    prisma.role.count(),
    prisma.externalCompany.count(),
  ]);
  console.log("orgs:", orgs, "users:", users, "perms:", perms, "roles:", roles, "companies:", companies);
  
  // Verify @@unique([organizationId, username]) constraint by checking admin exists in each org
  const adminUsers = await prisma.user.findMany({
    where: { username: "admin" },
    select: { username: true, email: true, organizationId: true, active: true }
  });
  console.log("\nAdmin users across orgs:", adminUsers.length, "(expected 4)");
  adminUsers.forEach(u => console.log(" -", u.email, "active:", u.active));
  
  // Check session table
  const sessions = await prisma.session.count();
  console.log("\nSessions:", sessions);
  
  // Show a sample session if any
  const sampleSession = await prisma.session.findFirst({ select: { expiresAt: true, token: true } });
  if (sampleSession) {
    const now = new Date();
    const diffDays = (sampleSession.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    console.log("Sample session expiresAt:", sampleSession.expiresAt, `(${diffDays.toFixed(1)} days from now)`);
  }
  
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
