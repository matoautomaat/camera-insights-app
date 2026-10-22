"use server";

import { redirect } from "next/navigation";
import { logIn, type LoginResult } from "@/lib/auth";

/** Only a path inside this app, never another site. */
const safeNext = (value: FormDataEntryValue | null) => {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
};

export async function logInAction(_: LoginResult | null, form: FormData): Promise<LoginResult> {
  const password = String(form.get("password") ?? "").slice(0, 200);
  const result = await logIn(password);
  if (result === "ok") redirect(safeNext(form.get("next")));
  return result;
}
