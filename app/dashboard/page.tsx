import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { LogoutButton } from "./logout-button";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Protected proof page (Server Component).
 *
 * Verifies the session, then displays the authenticated user's identity and
 * effective permissions.  If no valid session exists (or user is inactive),
 * redirects to /login on the current subdomain.
 */
export default async function DashboardPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const [org, role, rolePermissions] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: { name: true, slug: true },
    }),
    prisma.role.findUnique({
      where: { id: session.roleId },
      select: { name: true },
    }),
    prisma.rolePermission.findMany({
      where: { roleId: session.roleId },
      include: { permission: { select: { code: true } } },
    }),
  ]);

  const permissionCodes = rolePermissions.map((rp) => rp.permission.code);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <main className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Session verified — your identity and permissions below.
        </p>

        <div className="mt-6 rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">Username</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                {session.username}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">Organization</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                {org?.name ?? session.organizationId}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">Role</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                {role?.name ?? session.roleId}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="shrink-0 text-zinc-500 dark:text-zinc-400">
                Permissions
              </dt>
              <dd className="text-right font-mono text-xs text-zinc-900 dark:text-zinc-50">
                {permissionCodes.length > 0 ? permissionCodes.join(", ") : "none"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-4">
          <LogoutButton />
        </div>
      </main>
    </div>
  );
}
