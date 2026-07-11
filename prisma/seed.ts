import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// A few sample tenant organizations. Idempotent: re-running upserts by slug.
const organizations = [
  { slug: "vistra", name: "Vistra Partitions" },
  { slug: "acme-glass", name: "Acme Glass Co." },
  { slug: "nordic-walls", name: "Nordic Walls AB" },
  { slug: "clearline", name: "ClearLine Interiors" },
];

async function main() {
  for (const org of organizations) {
    await prisma.organization.upsert({
      where: { slug: org.slug },
      update: { name: org.name },
      create: org,
    });
  }

  const total = await prisma.organization.count();
  console.log(`Seeded organizations. Total in DB: ${total}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
