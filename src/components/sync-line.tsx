import type { Messages } from "@/i18n/en";
import { fmt, type Format } from "@/i18n/format";
import { isSalesSource } from "@/lib/payter";
import type { SyncState } from "@/lib/sync";

/** When UniFi and Payter were last read, the oldest of the two counting, or what went wrong. */
export function SyncLine({ states, m, f }: { states: SyncState[]; m: Messages; f: Format }) {
  const reading = states.filter((s) => s.source === "consoles" || s.source.startsWith("protect:") || isSalesSource(s.source));
  const failed = reading.find((s) => s.lastError)?.lastError ?? null;
  const runs = reading.map((s) => s.lastRun).filter((run): run is string => Boolean(run)).sort();
  const text = failed
    ? failed === "busy"
      ? m.overview.readBusy
      : fmt(m.overview.readFailed, { error: failed.slice(0, 80) })
    : runs.length
      ? fmt(m.overview.readAt, { time: f.dateTime(runs[0]) })
      : m.overview.readNever;
  return <span className={`text-[13px] ${failed && failed !== "busy" ? "text-warn" : "text-muted"}`}>{text}</span>;
}
