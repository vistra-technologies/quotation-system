import { spawnSync } from "node:child_process";

const MIGRATING_BRANCHES = new Set(["master", "staging"]);
const ref = process.env.VERCEL_GIT_COMMIT_REF;
const skipMigrate = process.env.VERCEL === "1" && ref && !MIGRATING_BRANCHES.has(ref);

function run(args, env = process.env) {
  const r = spawnSync("npx", args, { stdio: "inherit", shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run(["prisma", "generate"]);
if (skipMigrate) {
  console.log(`Skipping prisma migrate deploy on branch "${ref}" (only master/staging migrate).`);
} else {
  // Migrate must NOT go through pgbouncer: Prisma's session-level advisory lock gets taken and
  // released on different pooled backends, leaking a lock that makes later migrates time out (P1002).
  run(["prisma", "migrate", "deploy"], {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
  });
}
run(["next", "build"]);
