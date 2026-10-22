import type { Metadata, Viewport } from "next";
import { I18nProvider } from "@/i18n/client";
import { getI18n } from "@/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return {
    title: { default: m.brand, template: `%s · ${m.brand}` },
    description: m.overview.subtitle,
    robots: { index: false, follow: false },
    appleWebApp: { capable: true, title: m.brand, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f6f8",
};

// Light or dark before the first paint: the choice made here (ThemeToggle), or else the phone's own setting,
// also when that changes in the evening.
const THEME_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage.getItem("ci-theme"),q=window.matchMedia("(prefers-color-scheme: dark)");function a(){var dark=s?s==="dark":q.matches;d.classList.toggle("dark",dark);var t=document.querySelector('meta[name="theme-color"]');if(t)t.setAttribute("content",dark?"#0b1018":"#f5f6f8")}a();q.addEventListener("change",function(){s=localStorage.getItem("ci-theme");a()})}catch(e){}})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, m } = await getI18n();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <I18nProvider locale={locale} messages={m}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
