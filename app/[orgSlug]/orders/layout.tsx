import { NextIntlClientProvider } from "next-intl";
import allMessages from "@/messages/en.json";

/**
 * Orders section layout (Server Component).
 *
 * Provides NextIntlClientProvider for any Client Components under this route.
 * The list-page-controls.tsx shared component does not use useTranslations(),
 * so no named namespaces are currently required. The `common` namespace is
 * forwarded as a safety baseline for future additions.
 *
 * Auth is NOT gated here — orders/page.tsx handles its own /me call,
 * matching the projects and inquiries layout pattern.
 *
 * Stage 12 Batch 7e: reduced page margins to match the list-page pattern
 * (28px top × 32px sides × 48px bottom; max-width 1180px), consistent with
 * the updated inquiries layout from Batch 7c.
 */
export default function OrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const clientMessages = {
    common: allMessages.common,
  };

  return (
    <NextIntlClientProvider messages={clientMessages}>
      <div className="mx-auto w-full max-w-[1180px] px-8 pb-12 pt-7">
        {children}
      </div>
    </NextIntlClientProvider>
  );
}
