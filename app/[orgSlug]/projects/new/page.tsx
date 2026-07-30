import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/data/session";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { CreateProjectForm } from "./create-project-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create-project page (Server Component shell).
 *
 * Any authenticated user in the org may create a project — no special
 * RBAC permission is required beyond a valid session for this org.
 *
 * If the session user is tied to a fixed ExternalCompany (distributor /
 * architectural-firm user), the Client field is locked to that company —
 * only that company's name is fetched for display.  Otherwise the full
 * org list is fetched for the free-choice dropdown (current behavior).
 *
 * Stage 12: requireSession kept for session.externalCompanyId check (needed
 * for UI branching). External-company reads switched from lib/data DAL calls to
 * internalFetch against GET /api/v1/orgs/[orgSlug]/external-companies/*.
 */
export default async function NewProjectPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  // requireSession kept here: session.externalCompanyId drives the locked/free-choice branch.
  const session = await requireSession(orgSlug);

  let lockedCompany: { id: string; name: string } | null = null;
  let externalCompanies: { id: string; name: string }[] = [];

  if (session.externalCompanyId) {
    // External user — fetch only their locked company for read-only display.
    const res = await internalFetch(
      `/api/v1/orgs/${orgSlug}/external-companies/${session.externalCompanyId}`,
    );
    if (res.status === 401 || res.status === 403) {
      redirect(await orgHref(orgSlug, "/login"));
    }
    if (res.ok) {
      const body = (await res.json()) as { company: { id: string; name: string } };
      lockedCompany = body.company;
    }
  } else {
    // Member/admin — fetch the full org company list for the dropdown.
    const res = await internalFetch(
      `/api/v1/orgs/${orgSlug}/external-companies`,
    );
    if (res.status === 401 || res.status === 403) {
      redirect(await orgHref(orgSlug, "/login"));
    }
    if (res.ok) {
      const body = (await res.json()) as {
        companies: { id: string; name: string }[];
      };
      externalCompanies = body.companies;
    }
  }

  const t = await getTranslations("projects");

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href={`/${orgSlug}/projects`}
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

      <CreateProjectForm
        orgSlug={orgSlug}
        lockedCompany={lockedCompany}
        externalCompanies={externalCompanies}
      />
    </div>
  );
}
