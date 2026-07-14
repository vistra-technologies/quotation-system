import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/session";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { CreateRoleForm } from "./create-role-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create-role page (Server Component shell).
 *
 * Handles auth + RBAC gate server-side, then delegates form rendering to the
 * CreateRoleForm Client Component (which needs to be a Client Component so
 * useFormStatus() can drive the loading overlay).
 */
export default async function NewRolePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await getSession();
  if (!session) redirect(`/${orgSlug}/login`);

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (e) {
    if (e instanceof ForbiddenError) redirect(`/${orgSlug}/dashboard`);
    throw e;
  }

  const t = await getTranslations("roles");

  return (
    <div>
      <Link
        href={`/${orgSlug}/admin/roles`}
        className="mb-4 inline-block text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        {t("backToList")}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t("createPageTitle")}
      </h1>

      <div className="mt-6 max-w-lg rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <CreateRoleForm
          orgSlug={orgSlug}
          fieldNameLabel={t("fieldName")}
          fieldDescriptionLabel={t("fieldDescription")}
          submitLabel={t("submitCreate")}
        />
      </div>
    </div>
  );
}
