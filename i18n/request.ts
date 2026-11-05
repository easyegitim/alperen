import { getRequestConfig } from "next-intl/server";

// Tek dil (tr). P1'de en.json eklendiğinde locale profil/çerezden okunur (SPEC 3.2, F22).
export const LOCALE = "tr" as const;

export default getRequestConfig(async () => ({
  locale: LOCALE,
  messages: (await import(`../messages/${LOCALE}.json`)).default,
  timeZone: "Europe/Istanbul",
}));
