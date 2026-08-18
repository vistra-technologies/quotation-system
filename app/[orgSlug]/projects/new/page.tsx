import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
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
 * Stage 14 Batch C: widened lockedCompany / externalCompanies type casts to
 * include `country` (for GST conditional derivation, D19/D20). Removed the
 * single-card wrapper — form now renders its own 3-card layout per the mockup.
 */
export default async function NewProjectPage({
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

  // country + defaultCurrency included so the form can derive GST conditional (D20)
  // and default the currency select (C6 — Stage 15 Batch F).
  let lockedCompany: { id: string; name: string; country: "INDIA" | "UAE"; defaultCurrency: string } | null = null;
  let externalCompanies: { id: string; name: string; country: "INDIA" | "UAE"; defaultCurrency: string }[] = [];

  if (me.externalCompanyId) {
    // External user — fetch only their locked company for read-only display.
    const res = await internalFetch(
      `/api/v1/orgs/${orgSlug}/external-companies/${me.externalCompanyId}`,
    );
    if (res.status === 401 || res.status === 403) {
      redirect(await orgHref(orgSlug, "/login"));
    }
    if (res.ok) {
      const body = (await res.json()) as {
        company: { id: string; name: string; country: "INDIA" | "UAE"; defaultCurrency: string };
      };
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
        companies: { id: string; name: string; country: "INDIA" | "UAE"; defaultCurrency: string }[];
      };
      externalCompanies = body.companies;
    }
  }

  const t = await getTranslations("projects");

  return (
    <div>
      {/* Back link */}
      <Link
        href={`${base}/projects`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        {t("backToList")}
      </Link>

      {/* Page heading */}
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold text-text-heading">
          {t("createPageTitle")}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {t("createPageSubtitle")}
        </p>
      </div>

      {/* 3-card form — no card wrapper; the form renders its own cards */}
      <CreateProjectForm
        orgSlug={orgSlug}
        backHref={`${base}/projects`}
        lockedCompany={lockedCompany}
        externalCompanies={externalCompanies}
      />
    </div>
  );
}
