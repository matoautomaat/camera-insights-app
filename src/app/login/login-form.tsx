"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { logInAction } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const { m } = useI18n();
  const [result, action, pending] = useActionState(logInAction, null);
  const [visible, setVisible] = useState(false);
  const message = result === "wrong" ? m.login.wrong : result === "tooMany" ? m.login.tooMany : result === "notSetUp" ? m.login.notSetUp : null;
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
        {m.login.password}
        <span className="relative">
          <input
            name="password"
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            required
            autoFocus
            className="field pr-12"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? m.login.hide : m.login.show}
            title={visible ? m.login.hide : m.login.show}
            className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-ink"
          >
            {visible ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        </span>
      </label>
      {message && (
        <p role="alert" className="text-[14px] font-medium text-down">
          {message}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? m.login.busy : m.login.submit}
      </button>
    </form>
  );
}
