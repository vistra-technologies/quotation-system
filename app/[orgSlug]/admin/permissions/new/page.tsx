import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/session";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { orgHref } from "@/lib/orgHref";
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
 *
 * Stage 11 (Batch 9): restyled to Sage Ease tokens.
 */
export default async function CreatePermissionPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");
  const session = await getSession();

  if (!session) {
    redirect(`${base}/login`);
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      redirect(`${base}/dashboard`);
    }
    throw e;
  }

  const t = await getTranslations("permissions");

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-8">
      <Link
        href={`${base}/admin/permissions`}
        className="text-sm text-text-muted hover:text-text-heading"
      >
        {t("backToList")}
      </Link>

      <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-text-heading">
        {t("createPageTitle")}
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        {t("createPageSubtitle")}
      </p>

      {/* Inert-by-design caveat — prominent amber alert, required by DoD */}
      <div className="mt-5 rounded-md border border-amber-300 bg-amber-50 px-5 py-4">
        <p className="text-sm font-medium text-amber-800">
          {t("inertCaveat")}
        </p>
      </div>

      <div className="mt-6 rounded-md border border-border bg-bg-card px-5 py-4 shadow-card">
        <CreatePermissionForm orgSlug={orgSlug} />
      </div>
    </div>
  );
}
