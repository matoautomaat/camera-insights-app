// Numbers, money and dates the Belgian way (nl-BE), or British English, always on Brussels time.
// No server imports: the server and the browser both use it.

export type Locale = "nl" | "en";
export const LOCALES: Locale[] = ["nl", "en"];
export const LOCALE_COOKIE = "ci-lang";
const TIME_ZONE = "Europe/Brussels";

export const intlLocale = (locale: Locale) => (locale === "nl" ? "nl-BE" : "en-GB");

/** "{n} a day" with its values filled in. */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

export function makeFormat(locale: Locale) {
  const tag = intlLocale(locale);
  const number = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const euro = new Intl.NumberFormat(tag, { style: "currency", currency: "EUR" });
  const percent = new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 0 });
  const dateTime = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const dayMonth = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, day: "numeric", month: "short" });
  const date = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
  const timeSeconds = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const at = (value: string | number | Date) => new Date(value);
  return {
    number: (n: number) => number.format(n),
    euro: (n: number) => euro.format(n),
    percent: (share: number) => percent.format(share),
    dateTime: (value: string | number | Date) => dateTime.format(at(value)),
    dayMonth: (value: string | number | Date) => dayMonth.format(at(value)),
    date: (value: string | number | Date) => date.format(at(value)),
    time: (value: string | number | Date) => time.format(at(value)),
    timeSeconds: (value: string | number | Date) => timeSeconds.format(at(value)),
  };
}

export type Format = ReturnType<typeof makeFormat>;

/** The language a browser asks for, from its Accept-Language header: Dutch or French-speaking Belgium reads Dutch. */
export function localeFrom(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (cookie === "nl" || cookie === "en") return cookie;
  const first = acceptLanguage?.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "nl";
}
