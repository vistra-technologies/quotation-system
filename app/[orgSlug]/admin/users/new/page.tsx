import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/session";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { CreateUserForm } from "./create-user-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create-user page (Server Component shell).
 *
 * Fetches the org's roles and external companies for the form dropdowns,
 * then delegates the interactive form to the CreateUserForm Client Component.
 */
export default async function NewUserPage({
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
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      redirect(`/${orgSlug}/dashboard`);
    }
    throw e;
  }

  const [roles, externalCompanies, t] = await Promise.all([
    prisma.role.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.externalCompany.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getTranslations("users"),
  ]);

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href={`/${orgSlug}/admin/users`}
        className="mb-4 inline-block text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        {t("backToList")}
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t("createPageTitle")}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {t("createPageSubtitle")}
      </p>

      <CreateUserForm
        orgSlug={orgSlug}
        roles={roles}
        externalCompanies={externalCompanies}
      />
    </div>
  );
}
