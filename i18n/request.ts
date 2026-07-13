import { getRequestConfig } from "next-intl/server";

/**
 * next-intl request configuration — single English locale, no locale-prefix routing.
 * All Stage 3 UI strings live in messages/en.json.
 * See: https://next-intl.dev/docs/usage/configuration#i18n-request
 */
export default getRequestConfig(async () => {
  return {
    locale: "en",
    messages: (await import("../messages/en.json")).default,
  };
});
