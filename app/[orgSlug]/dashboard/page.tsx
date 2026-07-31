import { redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Dashboard landing page (Server Component).
 *
 * Displays the authenticated user's identity and effective permissions.
 * Navigation is provided by the shared app/[orgSlug]/layout.tsx side panel —
 * the nav buttons that previously lived here have been removed in Stage 8.
 * Redirects to /{orgSlug}/login if no valid session exists.
 *
 * Stage 12 Batch 6: switched from getSession()/getOrgById()/getSessionRole()/
 * getSessionRolePermissions() DAL to a single internalFetch against
 * /api/v1/orgs/[orgSlug]/me (rich response per plan-batch6.md D2).
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const meRes = await internalFetch(`/api/v1/orgs/${orgSlug}/me`);
  if (meRes.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (meRes.status === 403) redirect(await orgHref(orgSlug, "/login"));

  const me = (await meRes.json()) as {
    username: string;
    orgName: string;
    roleName: string;
    permissionCodes: string[];
  };

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
              {me.username}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-400">Organization</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">
              {me.orgName}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-400">Role</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">
              {me.roleName}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="shrink-0 text-zinc-500 dark:text-zinc-400">
              Permissions
            </dt>
            <dd className="text-right font-mono text-xs text-zinc-900 dark:text-zinc-50">
              {me.permissionCodes.length > 0 ? me.permissionCodes.join(", ") : "none"}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
