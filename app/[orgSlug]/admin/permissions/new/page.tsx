import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { CreatePermissionForm } from "./_components/create-permission-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create permission page (Server Component shell).
 *
 * Auth gate is server-side via the /me route. The form itself is a Client Component
 * so it can use useActionState for user-readable error display and LoadingOverlay
 * for the pending state.
 *
 * Stage 12 Batch 6: switched from getSession()/requirePermission() to
 * internalFetch against /api/v1/orgs/[orgSlug]/me for MANAGE_FEATURES check.
 */
export default async function CreatePermissionPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const meRes = await internalFetch(`/api/v1/orgs/${orgSlug}/me`);
  if (meRes.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (meRes.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  const me = (await meRes.json()) as { adminPermissions: string[] };
  if (!me.adminPermissions.includes("MANAGE_FEATURES")) {
    redirect(await orgHref(orgSlug, "/dashboard"));
  }

  const t = await getTranslations("permissions");

  return (
    <div className="mx-auto max-w-lg">
      <div className="flex items-center gap-3">
        <Link
          href={`/${orgSlug}/admin/permissions`}
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          {t("backToList")}
        </Link>
      </div>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t("createPageTitle")}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {t("createPageSubtitle")}
      </p>

      {/* Inert-by-design caveat — prominent amber alert, required by DoD */}
      <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 dark:border-amber-700 dark:bg-amber-950">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
          {t("inertCaveat")}
        </p>
      </div>

      <CreatePermissionForm orgSlug={orgSlug} />
    </div>
  );
}
