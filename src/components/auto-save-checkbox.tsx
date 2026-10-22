"use client";

import type { InputHTMLAttributes } from "react";

/** A tick that saves its form at once (Xin, 22-10-2026: the links were ticked, but "Opslaan" was never pressed). */
export function AutoSaveCheckbox(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange">) {
  return <input type="checkbox" {...props} onChange={(event) => event.currentTarget.form?.requestSubmit()} />;
}
