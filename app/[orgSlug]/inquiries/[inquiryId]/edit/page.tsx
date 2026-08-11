import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { EditInquiryForm } from "./edit-inquiry-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

interface InquiryDetail {
  id: string;
  inquiryNumber: number;
  companyInquiryNumber: number | null;
  name: string;
  destinationCountry: string;
  currency: string;
  projectLocation: string | null;
  status: string;
  externalCompany: { id: string; name: string } | null;
}

/**
 * Edit-inquiry page (Server Component shell).
 *
 * Fetches the existing inquiry to pre-fill the form. If the inquiry is not
 * status === "NEW", redirects to the detail page (edit is only valid while NEW).
 *
 * Auth gate: any authenticated org member — matches the inquiry detail page.
 * Tenancy guard: the API route's getApiSession() enforces cross-org isolation.
 *
 * Stage 13 Batch 6.
 */
export default async function EditInquiryPage({
  params,
}: {
  params: Promise<{ orgSlug: string; inquiryId: string }>;
}) {
  const { orgSlug, inquiryId } = await params;
  const base = await orgHref(orgSlug, "");
  const detailHref = `${base}/inquiries/${inquiryId}`;

  const [res, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/inquiries/${inquiryId}`),
    getTranslations("inquiries"),
  ]);

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!res.ok) {
    notFound();
  }

  const { inquiry } = (await res.json()) as { inquiry: InquiryDetail };

  // Only NEW inquiries are editable — redirect closed ones to detail.
  if (inquiry.status !== "NEW") {
    redirect(detailHref);
  }

  return (
    <div>
      {/* ── Back link ───────────────────────────────────────────────────────── */}
      <Link
        href={detailHref}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        {t("backToInquiry")}
      </Link>

      {/* ── Page heading ─────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h1 className="text-[27px] font-extrabold text-text-heading">
          {t("editPageTitle")}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {t("editPageSubtitle")}
        </p>
      </div>

      <EditInquiryForm
        orgSlug={orgSlug}
        inquiryId={inquiryId}
        initialName={inquiry.name}
        initialDestinationCountry={inquiry.destinationCountry}
        initialCurrency={inquiry.currency}
        initialProjectLocation={inquiry.projectLocation}
        externalCompany={inquiry.externalCompany}
        backHref={detailHref}
      />
    </div>
  );
}
