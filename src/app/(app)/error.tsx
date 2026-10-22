"use client";

import { RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n/client";

/** Anything else that breaks a page: say so in the app's own words, with a way to try again. */
export default function PageError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { m } = useI18n();
  return (
    <section role="alert" className="card mx-auto max-w-xl px-6 py-7">
      <h1 className="text-[20px] font-bold">{m.common.error}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">{m.setup.error}</p>
      <button type="button" className="btn btn-primary mt-5" onClick={() => retry()}>
        <RefreshCw aria-hidden="true" />
        {m.setup.retry}
      </button>
    </section>
  );
}
