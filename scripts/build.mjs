import { spawnSync } from "node:child_process";

const MIGRATING_BRANCHES = new Set(["master", "staging"]);
const ref = process.env.VERCEL_GIT_COMMIT_REF;
const skipMigrate = process.env.VERCEL === "1" && ref && !MIGRATING_BRANCHES.has(ref);

function run(args) {
  const r = spawnSync("npx", args, { stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run(["prisma", "generate"]);
if (skipMigrate) {
  console.log(`Skipping prisma migrate deploy on branch "${ref}" (only master/staging migrate).`);
} else {
  run(["prisma", "migrate", "deploy"]);
}
run(["next", "build"]);
