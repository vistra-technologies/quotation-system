import { NextIntlClientProvider } from "next-intl";
import allMessages from "@/messages/en.json";

/**
 * Inquiries section layout (Server Component).
 *
 * Provides NextIntlClientProvider so Client Components under this layout
 * (e.g. CreateInquiryForm, StartProjectButton) can use useTranslations().
 *
 * Auth is NOT gated here — each page handles its own requireSession() call,
 * because the inquiry list is accessible to any authenticated user without
 * a special permission, mirroring the projects layout pattern.
 *
 * Only the `inquiries` and `common` namespaces are forwarded to the client —
 * the full messages/en.json is never sent wholesale.
 */
export default function InquiriesLayout({ children }: { children: React.ReactNode }) {
  const clientMessages = {
    common: allMessages.common,
    inquiries: allMessages.inquiries,
  };

  return (
    <NextIntlClientProvider messages={clientMessages}>
      <div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>
    </NextIntlClientProvider>
  );
}
