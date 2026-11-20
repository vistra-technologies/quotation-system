import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isSupportedCurrency } from "@/lib/currency";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { SettingsForm } from "./_settings-form";

// Always render live: reads the session cookie and the DB.
export const dynamic = "force-dynamic";

/**
 * Organization Settings page (Stage 38a, Q-D24, mockup B1 layout B). Server Component.
 *
 * Page guard is the settings GET itself (MANAGE_ORG): 401 goes to login, 403 (a user without the permission)
 * goes to the dashboard, like the other admin pages. Any other failure shows a load error, never a full-page crash.
 * The title and the section cards live in the client form (each section owns its Edit).
 */
export default async function OrganizationSettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;

  const [res, t] = await Promise.all([internalFetch(`/api/v1/orgs/${orgSlug}/settings`), getTranslations("orgSettings")]);

  if (res.status === 401) redirect(await orgHref(orgSlug, "/login"));
  if (res.status === 403) redirect(await orgHref(orgSlug, "/dashboard"));

  const body = res.ok ? ((await res.json().catch(() => null)) as { defaultCurrency?: unknown } | null) : null;
  if (!body || !isSupportedCurrency(body.defaultCurrency)) {
    return (
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-text-heading">{t("pageTitle")}</h1>
        <div role="alert" className="mt-5 rounded-sm border border-danger-border bg-danger-bg px-3.5 py-3 text-[13px] font-semibold text-red-700">
          {t("loadError")}
        </div>
      </div>
    );
  }

  return <SettingsForm orgSlug={orgSlug} defaultCurrency={body.defaultCurrency} />;
}
