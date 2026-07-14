import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/session";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { CreatePermissionForm } from "./_components/create-permission-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create permission page (Server Component shell).
 *
 * Auth gate is server-side. The form itself is a Client Component so it can
 * use useActionState for user-readable error display and LoadingOverlay for
 * the pending state. The inert-by-design caveat is rendered here (server side)
 * so it is always visible regardless of JS availability.
 *
 * ⚠ Inert caveat rendered prominently as an amber alert — a hard DoD requirement.
 */
export default async function CreatePermissionPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await getSession();

  if (!session) {
    redirect(`/${orgSlug}/login`);
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      redirect(`/${orgSlug}/dashboard`);
    }
    throw e;
  }

  const t = await getTranslations("permissions");

  return (
    <div className="max-w-lg">
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
