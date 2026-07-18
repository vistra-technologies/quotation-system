import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/data/session";
import { getInquiryById } from "@/lib/data/inquiries";
import { dismissInquiry } from "../actions";
import { StartProjectButton } from "./start-project-button";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Inquiry detail page (Server Component).
 *
 * Auth gate: requireSession only — no special permission required.
 * Renders inquiry metadata, a Dismiss form (RSC form, no client component needed),
 * and the "Start Project" button (client component, uses useActionState for
 * inline SEQUENCE_CONFLICT error surfacing).
 *
 * Tenancy guard: getInquiryById returns null if the inquiry doesn't exist or
 * belongs to a different org → notFound().
 */
export default async function InquiryDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; inquiryId: string }>;
}) {
  const { orgSlug, inquiryId } = await params;
  const session = await requireSession(orgSlug);

  const [inquiry, t] = await Promise.all([
    getInquiryById(session, inquiryId),
    getTranslations("inquiries"),
  ]);

  // Tenancy guard: inquiry not found or belongs to a different org.
  if (!inquiry) notFound();

  const isClosed = inquiry.status === "DISMISSED" || inquiry.status === "CONVERTED";

  return (
    <div>
      {/* Back link */}
      <Link
        href={`/${orgSlug}/inquiries`}
        className="mb-4 inline-block text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        {t("backToList")}
      </Link>

      {/* Inquiry metadata */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          #{inquiry.inquiryNumber} — {inquiry.name}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
          <span>{inquiry.destinationCountry}</span>
          <span>{inquiry.currency}</span>
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {inquiry.status === "NEW"
              ? t("statusNew")
              : inquiry.status === "DISMISSED"
                ? t("statusDismissed")
                : t("statusConverted")}
          </span>
          {inquiry.externalCompany && (
            <span>{inquiry.externalCompany.name}</span>
          )}
          <span className="text-zinc-400 dark:text-zinc-600">
            {t("colDate")}: {new Date(inquiry.createdAt).toLocaleDateString()}
          </span>
          <span className="text-zinc-400 dark:text-zinc-600">
            {inquiry.createdBy.username}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Dismiss — RSC form, no client component needed */}
        <form action={dismissInquiry}>
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <input type="hidden" name="inquiryId" value={inquiryId} />
          <button
            type="submit"
            disabled={isClosed}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t("dismissAction")}
          </button>
        </form>

        {/* Start Project — client component (needs useActionState for SEQUENCE_CONFLICT) */}
        <StartProjectButton
          orgSlug={orgSlug}
          inquiryId={inquiryId}
          disabled={isClosed}
        />
      </div>
    </div>
  );
}
