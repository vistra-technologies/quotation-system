/**
 * One-off: rotate the `admin` password in every organization.
 *
 * Why this exists instead of the seed: `prisma/seed.ts` is idempotent by
 * SKIPPING users that already exist (`if (existing) continue;`) and never
 * touches passwords. So changing SEED_PASSWORD and re-seeding a database that
 * already has these users is a no-op. Rotation needs an explicit update.
 *
 * The new password is read from ADMIN_PASSWORD at runtime and is deliberately
 * NOT hardcoded here — this file is committed, the password must not be.
 *
 * Usage (PowerShell):
 *   $env:ADMIN_PASSWORD = "..."; npx tsx scripts/rotate-admin-password.ts
 *
 * Targets whatever DATABASE_URL points at. It prints the host and requires
 * --confirm before writing, because that is frequently production.
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { auth } from "@/lib/auth";

const USERNAME = "admin";

async function main() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      "ADMIN_PASSWORD is not set. Pass it at runtime; do not hardcode it.",
    );
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  // Surface the target before writing — this script is usually aimed at prod.
  const host = new URL(url).host;
  console.log(`Target database host: ${host}`);

  if (!process.argv.includes("--confirm")) {
    console.log("\nDry run. Re-run with --confirm to apply. Nothing written.");
    const preview = await listAdmins(url);
    console.table(preview);
    return;
  }

  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  try {
    // Same hasher better-auth uses at sign-in, so credential login keeps working.
    const authCtx = await auth.$context;
    const passwordHash = await authCtx.password.hash(password);

    const admins = await prisma.user.findMany({
      where: { username: USERNAME },
      select: { id: true, organization: { select: { slug: true } } },
    });

    if (admins.length === 0) {
      console.warn(`No users found with username "${USERNAME}". Nothing to do.`);
      return;
    }

    let updated = 0;
    for (const admin of admins) {
      // providerId "credential" is what better-auth's sign-in route looks up.
      const res = await prisma.account.updateMany({
        where: { userId: admin.id, providerId: "credential" },
        data: { password: passwordHash },
      });
      if (res.count === 0) {
        console.warn(
          `  ${admin.organization.slug}: no credential account row — skipped`,
        );
        continue;
      }
      console.log(`  ${admin.organization.slug}: password rotated`);
      updated += res.count;
    }

    console.log(`\nDone. ${updated} credential row(s) updated.`);
  } finally {
    await prisma.$disconnect();
  }
}

async function listAdmins(url: string) {
  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });
  try {
    const admins = await prisma.user.findMany({
      where: { username: USERNAME },
      select: {
        username: true,
        active: true,
        organization: { select: { slug: true } },
      },
    });
    return admins.map((a) => ({
      org: a.organization.slug,
      username: a.username,
      active: a.active,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
