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
 * Stage 11 (Batch 5): restyled to Sage Ease tokens — back link, page heading,
 * wider layout (removes max-w-lg), backHref passed to form for Cancel button.
 * No logic changes.
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
  const base = await orgHref(orgSlug, "");

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
  const backHref = `${base}/inquiries`;

  return (
    <div>
      {/* Back link */}
      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        {t("backToList")}
      </Link>

      {/* Page heading */}
      <div className="mb-6">
        <h1 className="text-[27px] font-extrabold text-text-heading">
          {t("createPageTitle")}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {t("createPageSubtitle")}
        </p>
      </div>

      <CreateInquiryForm
        orgSlug={orgSlug}
        lockedCompany={lockedCompany}
        externalCompanies={externalCompanies}
        backHref={backHref}
      />
    </div>
  );
}
