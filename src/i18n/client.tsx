"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Messages } from "@/i18n/en";
import { makeFormat, type Locale } from "@/i18n/format";

// The browser gets the texts of one language from the server (layout.tsx), never all of them.

const I18nContext = createContext<{ locale: Locale; m: Messages } | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const value = useMemo(() => ({ locale, m: messages }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n outside I18nProvider");
  const f = useMemo(() => makeFormat(value.locale), [value.locale]);
  return { locale: value.locale, m: value.m, f };
}
