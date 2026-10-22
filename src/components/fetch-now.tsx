"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { fetchNow } from "@/app/(app)/actions";

/** Reads UniFi and Payter now instead of waiting for the next run; the first time takes a while (30 days of detections). */
export function FetchNow() {
  const { m } = useI18n();
  const [pending, start] = useTransition();
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  return (
    <button
      type="button"
      className="btn btn-secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          setState("idle");
          try {
            await fetchNow();
            setState("done");
          } catch {
            setState("error");
          }
        })
      }
    >
      <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden="true" />
      {pending ? m.common.fetching : state === "done" ? m.common.fetched : state === "error" ? m.common.error : m.common.fetchNow}
    </button>
  );
}
