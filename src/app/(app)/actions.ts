"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logOut, requireLogin } from "@/lib/auth";
import { LOCALE_COOKIE, LOCALES, type Locale } from "@/i18n/format";
import { DEMO } from "@/lib/data";
import { runSync } from "@/lib/sync";

/** "Fetch now": read UniFi and Payter whatever their last read, then show the pages again. */
export async function fetchNow(): Promise<void> {
  await requireLogin();
  if (!DEMO) await runSync({ force: true, budgetMs: 50_000 });
  revalidatePath("/", "layout");
}

export async function logOutAction(): Promise<void> {
  await logOut();
  redirect("/login");
}

export async function setLanguage(form: FormData): Promise<void> {
  await requireLogin();
  const locale = String(form.get("locale")) as Locale;
  if (!LOCALES.includes(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 400 * 86_400, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
}
