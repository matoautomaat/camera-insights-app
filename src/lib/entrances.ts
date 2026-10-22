import { compareSince, type Verdict } from "@/lib/stats";

// Everyone who comes in, counted once (Xin, 22-10-2026: "each person individually, not counting all the time he or
// she gets caught on different cameras"). Only the cameras marked as entrance count, as ci_entrances_report gives it:
// a line across the door in UniFi Protect when a camera has one (each crossing is one person coming in), otherwise
// its person detections at the door (an estimate). The same person on two cameras is never matched: that would take
// biometrics. No server imports: the pages and the tests share it.

/** How a camera counts: "line" a line across the door in Protect (exact), "zone" its detections (an estimate). */
export type EntryMethod = "line" | "zone";

export type EntrancesReport = {
  cur_start: string;
  cur_end: string;
  prev_start: string;
  timezone: string;
  cameras: { camera_id: string; method: EntryMethod }[];
  entries: number;
  prev_entries: number;
  /** The first count by the method used now: a line drawn last week makes the count "new since". */
  first_event: string | null;
  by_day: { day: string; visits: number }[];
  by_hour: { hour: number; visits: number }[];
  by_weekday: { weekday: number; visits: number }[];
};

/** Exact only when every entrance camera counts with a line. */
export function entryMethod(report: Pick<EntrancesReport, "cameras">): EntryMethod {
  return report.cameras.length > 0 && report.cameras.every((c) => c.method === "line") ? "line" : "zone";
}

/** People who came in against the period before, or "new since" when counting started after that began. */
export function entriesVerdict(report: Pick<EntrancesReport, "entries" | "prev_entries" | "first_event" | "prev_start">): Verdict {
  return compareSince(report.entries, report.prev_entries, report.first_event, report.prev_start);
}
