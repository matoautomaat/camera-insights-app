"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useI18n } from "@/i18n/client";

export const THEME_KEY = "ci-theme";

/** Follows the class on <html>, which the script in layout.tsx sets before the first paint. */
function subscribe(changed: () => void) {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const isDark = () => document.documentElement.classList.contains("dark");

/** Light or dark, remembered in this browser. Without a choice the phone's own setting decides (layout.tsx). */
export function ThemeToggle() {
  const { m } = useI18n();
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  function flip() {
    const next = !isDark();
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      // A private window may not store it; the choice then holds until the page closes.
    }
  }

  const label = dark ? m.nav.light : m.nav.dark;
  return (
    <button type="button" onClick={flip} className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface hover:text-ink" aria-label={label} title={label}>
      {dark ? <Sun className="size-[19px]" /> : <Moon className="size-[19px]" />}
    </button>
  );
}
