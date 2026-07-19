import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getOrgById, getSessionRole, getSessionRolePermissions } from "@/lib/data/admin";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Dashboard landing page (Server Component).
 *
 * Displays the authenticated user's identity and effective permissions.
 * Navigation is provided by the shared app/[orgSlug]/layout.tsx side panel —
 * the nav buttons that previously lived here have been removed in Stage 8.
 * Redirects to /{orgSlug}/login if no valid session exists.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await getSession();

  if (!session) {
    redirect(`/${orgSlug}/login`);
  }

  const [org, role, permissionCodes] = await Promise.all([
    getOrgById(session.organizationId),
    getSessionRole(session),
    getSessionRolePermissions(session),
  ]);

  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Dashboard
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Session verified — your identity and permissions below.
      </p>

      <div className="mt-6 w-full max-w-lg rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
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
    </div>
  );
}
