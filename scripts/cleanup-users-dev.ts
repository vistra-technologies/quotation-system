/**
 * Temporary dev-DB cleanup script — Batch 7g migration prep only.
 *
 * Deletes all user-dependent domain data from the dev Neon branch so that
 * `prisma migrate dev` can add NOT NULL columns (firstName, lastName) to
 * the user table without a default.  Authorized by human decision (2026-07-31).
 *
 * SAFETY CHECK: script aborts if DATABASE_URL is not the dev branch endpoint.
 * NEVER run this against production (ep-little-paper-aipm0o0i).
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const DEV_BRANCH_HOSTNAME = "ep-dark-term-ai0ufj4k";
const PROD_BRANCH_HOSTNAME = "ep-little-paper-aipm0o0i";

const url = process.env.DATABASE_URL ?? "";

if (!url.includes(DEV_BRANCH_HOSTNAME)) {
  console.error(
    "ABORT: DATABASE_URL does not contain the dev branch hostname.",
    "\nExpected substring:", DEV_BRANCH_HOSTNAME,
    "\nGot (first 80 chars):", url.slice(0, 80),
  );
  if (url.includes(PROD_BRANCH_HOSTNAME)) {
    console.error("FATAL: DATABASE_URL appears to be the PRODUCTION branch — refusing to run.");
  }
  process.exit(1);
}

console.log("DATABASE_URL check: dev branch confirmed ✓");

const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Delete in FK-safe order (most-dependent first).
  // Session and Account have onDelete: Cascade from User, so they're handled
  // automatically when users are deleted.

  const partitions = await prisma.partition.deleteMany({});
  console.log(`Deleted ${partitions.count} partitions`);

  const floors = await prisma.floor.deleteMany({});
  console.log(`Deleted ${floors.count} floors`);

  const selections = await prisma.selection.deleteMany({});
  console.log(`Deleted ${selections.count} selections`);

  // Projects can reference Inquiries (inquiryId FK with SetNull), so delete
  // projects before inquiries to avoid constraint issues on the back-relation.
  const projects = await prisma.project.deleteMany({});
  console.log(`Deleted ${projects.count} projects`);

  const inquiries = await prisma.inquiry.deleteMany({});
  console.log(`Deleted ${inquiries.count} inquiries`);

  // User deletion cascades to Session + Account (onDelete: Cascade in schema).
  const users = await prisma.user.deleteMany({});
  console.log(`Deleted ${users.count} users (sessions/accounts cascaded)`);

  console.log("\nCleanup complete — ready for prisma migrate dev + prisma db seed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
