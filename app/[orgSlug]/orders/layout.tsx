import { NextIntlClientProvider } from "next-intl";
import allMessages from "@/messages/en.json";

/**
 * Orders section layout (Server Component).
 *
 * Provides NextIntlClientProvider so Client Components under this layout —
 * specifically <OrdersPlaceholder> which calls useTranslations("toast") for
 * the "Coming Soon" notification — can use useTranslations().
 *
 * Only the `toast` namespace is forwarded to the client; the full
 * messages/en.json is never sent wholesale. No `orders` namespace exists yet —
 * the Orders page is an inert placeholder with hardcoded static content.
 *
 * Auth is NOT gated here — orders/page.tsx handles its own requireSession()
 * call, matching the projects and inquiries layout pattern.
 *
 * Stage 10 — Task 1.8: new route. Per AGENTS.md: the `toast` namespace MUST
 * be in clientMessages for <Toast> to hydrate correctly (silent failure mode
 * has shipped before — see Stage 6 note).
 */
export default function OrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const clientMessages = {
    toast: allMessages.toast,
  };

  return (
    <NextIntlClientProvider messages={clientMessages}>
      <div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>
    </NextIntlClientProvider>
  );
}
