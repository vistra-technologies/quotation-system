import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { CreateInquiryForm } from "./create-inquiry-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Create-inquiry page (Server Component shell).
 *
 * Any authenticated user in the org may create an inquiry — no special
 * RBAC permission is required beyond a valid session for this org.
 *
 * If the session user is tied to a fixed ExternalCompany (distributor /
 * architectural-firm user), the Client field is locked to that company —
 * only that company's name is fetched for display.  Otherwise the full
 * org list is fetched for the free-choice dropdown (current behavior).
 *
 * Stage 12 Batch 6: switched requireSession → internalFetch /me.
 * externalCompanyId now comes from the /me response (plan-batch6.md D2).
 */
export default async function NewInquiryPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const meRes = await internalFetch(`/api/v1/orgs/${orgSlug}/me`);
  if (meRes.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (!meRes.ok) redirect(await orgHref(orgSlug, "/login"));

  const me = (await meRes.json()) as { externalCompanyId: string | null };

  let lockedCompany: { id: string; name: string } | null = null;
  let externalCompanies: { id: string; name: string }[] = [];

  if (me.externalCompanyId) {
    // External user — fetch only their locked company for read-only display.
    const res = await internalFetch(
      `/api/v1/orgs/${orgSlug}/external-companies/${me.externalCompanyId}`,
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

  const t = await getTranslations("inquiries");

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href={`/${orgSlug}/inquiries`}
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

      <CreateInquiryForm
        orgSlug={orgSlug}
        lockedCompany={lockedCompany}
        externalCompanies={externalCompanies}
      />
    </div>
  );
}
