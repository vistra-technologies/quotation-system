import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listInquiries } from "@/lib/data/inquiries";
import { requireSession } from "@/lib/data/session";
import { orgHref } from "@/lib/orgHref";
import { StartProjectButton } from "./[inquiryId]/start-project-button";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Inquiries list page (Server Component).
 *
 * Lists all inquiries within the session's org, newest-first.
 * Auth-protected (any authenticated user); no special RBAC permission required.
 *
 * Stage 11 (Batch 5): restyled to Sage Ease tokens — page header, count badge,
 * card/table, status badges, row-level StartProjectButton. No logic changes.
 */
export default async function InquiriesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");
  const session = await requireSession(orgSlug);

  const [inquiries, t] = await Promise.all([
    listInquiries(session),
    getTranslations("inquiries"),
  ]);

  /** Return status badge classes and label for a given inquiry status. */
  function statusBadge(status: string): { label: string; cls: string } {
    if (status === "NEW")
      return {
        label: t("statusNew"),
        cls: "bg-status-pending-bg text-status-pending-text",
      };
    if (status === "DISMISSED")
      return {
        label: t("statusDismissed"),
        cls: "bg-status-refunded-bg text-status-refunded-text",
      };
    return {
      label: t("statusConverted"),
      cls: "bg-status-paid-bg text-status-paid-text",
    };
  }

  return (
    <div>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-[27px] font-extrabold text-text-heading">
            {t("pageTitle")}
            <span className="rounded-pill bg-primary-softer px-2.5 py-0.5 text-xs font-bold text-primary-dark">
              {inquiries.length}
            </span>
          </h1>
          <p className="mt-1 text-sm text-text-muted">{t("pageSubtitle")}</p>
        </div>
        <Link
          href={`${base}/inquiries/new`}
          className="inline-flex items-center rounded-sm bg-primary px-4 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
        >
          + {t("createInquiry")}
        </Link>
      </div>

      {/* ── Table card ──────────────────────────────────────────────────────── */}
      <div className="rounded-md border border-border bg-bg-card shadow-card">
        {inquiries.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-text-muted">
            {t("noInquiries")}
          </p>
        ) : (
          <div className="overflow-x-auto px-4 pb-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    {t("colName")}
                  </th>
                  <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    {t("colStatus")}
                  </th>
                  <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    {t("colExternalCompany")}
                  </th>
                  <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    {t("colDate")}
                  </th>
                  {/* Actions column — no heading */}
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {inquiries.map((inquiry) => {
                  const { label, cls } = statusBadge(inquiry.status);
                  const isClosed =
                    inquiry.status === "DISMISSED" ||
                    inquiry.status === "CONVERTED";
                  return (
                    <tr
                      key={inquiry.id}
                      className="border-b border-border last:border-0 hover:bg-primary-softer/40"
                    >
                      {/* Name — linked to detail */}
                      <td className="px-3 py-3 font-bold text-text-heading">
                        <Link
                          href={`${base}/inquiries/${inquiry.id}`}
                          className="underline-offset-2 hover:text-primary-dark hover:underline"
                        >
                          {inquiry.name}
                        </Link>
                      </td>

                      {/* Status badge */}
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-bold ${cls}`}
                        >
                          {label}
                        </span>
                      </td>

                      {/* Client (external company) */}
                      <td className="px-3 py-3 text-text-body">
                        {inquiry.externalCompany?.name ?? (
                          <span className="text-text-placeholder">—</span>
                        )}
                      </td>

                      {/* Created date */}
                      <td className="px-3 py-3 text-text-muted">
                        {new Date(inquiry.createdAt).toLocaleDateString()}
                      </td>

                      {/* Row action */}
                      <td className="px-3 py-3">
                        <StartProjectButton
                          orgSlug={orgSlug}
                          inquiryId={inquiry.id}
                          disabled={isClosed}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
