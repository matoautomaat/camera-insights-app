import { cookies, headers } from "next/headers";
import { en, type Messages } from "@/i18n/en";
import { LOCALE_COOKIE, localeFrom, makeFormat, type Locale } from "@/i18n/format";
import { nl } from "@/i18n/nl";

/** The texts and formats for this request: the language chosen in Settings, or the browser's. */
export async function getI18n(): Promise<{ locale: Locale; m: Messages; f: ReturnType<typeof makeFormat> }> {
  const locale = localeFrom((await cookies()).get(LOCALE_COOKIE)?.value, (await headers()).get("accept-language"));
  return { locale, m: locale === "nl" ? nl : en, f: makeFormat(locale) };
}
