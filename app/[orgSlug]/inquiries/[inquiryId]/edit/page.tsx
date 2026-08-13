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
  // destinationCountry not used on this form (D19) but present in the response
  currency: string;
  projectLocation: string | null;
  status: string;
  externalCompany: { id: string; name: string; country: "INDIA" | "UAE" } | null;
  // Stage 14 Batch B — extended intake fields
  submissionDate: string | null;
  projectDeadline: string | null;
  projectBudget: string | null;
  mainContractorName: string | null;
  interiorContractorName: string | null;
  mainConsultantName: string | null;
  interiorConsultantName: string | null;
  endClientName: string | null;
  endClientPhone: string | null;
  endClientEmail: string | null;
  endClientAddressLine1: string | null;
  endClientAddressLine2: string | null;
  endClientCity: string | null;
  endClientState: string | null;
  endClientGstNumber: string | null;
}

/**
 * Edit-inquiry page (Server Component shell).
 *
 * Fetches the existing inquiry to pre-fill the form. If the inquiry is not
 * status === "NEW", redirects to the detail page (edit is only valid while NEW).
 *
 * Stage 14 Batch B: extended to pass all 15 new fields + companyCountry (for GST
 * conditional) to EditInquiryForm. initialDestinationCountry removed (D19).
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

  const formattedInquiryNumber =
    inquiry.companyInquiryNumber != null
      ? `INQ-${inquiry.companyInquiryNumber}`
      : `#${inquiry.inquiryNumber}`;

  // Dates come from the API as ISO strings — extract the date part for <input type="date">
  function toDateInput(iso: string | null): string | null {
    if (!iso) return null;
    return iso.split("T")[0];
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
        initialCurrency={inquiry.currency}
        initialProjectLocation={inquiry.projectLocation}
        initialSubmissionDate={toDateInput(inquiry.submissionDate)}
        initialProjectDeadline={toDateInput(inquiry.projectDeadline)}
        initialProjectBudget={inquiry.projectBudget}
        initialMainContractorName={inquiry.mainContractorName}
        initialInteriorContractorName={inquiry.interiorContractorName}
        initialMainConsultantName={inquiry.mainConsultantName}
        initialInteriorConsultantName={inquiry.interiorConsultantName}
        initialEndClientName={inquiry.endClientName}
        initialEndClientPhone={inquiry.endClientPhone}
        initialEndClientEmail={inquiry.endClientEmail}
        initialEndClientAddressLine1={inquiry.endClientAddressLine1}
        initialEndClientAddressLine2={inquiry.endClientAddressLine2}
        initialEndClientCity={inquiry.endClientCity}
        initialEndClientState={inquiry.endClientState}
        initialEndClientGstNumber={inquiry.endClientGstNumber}
        externalCompany={inquiry.externalCompany}
        companyCountry={inquiry.externalCompany?.country ?? null}
        inquiryNumberDisplay={formattedInquiryNumber}
        backHref={detailHref}
      />
    </div>
  );
}
