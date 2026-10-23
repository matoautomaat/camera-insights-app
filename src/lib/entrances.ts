import type { SalesReport } from "@/lib/sales";
import { compareSince, MIN_SALES, type Verdict } from "@/lib/stats";

// Everyone who comes in, counted once (Xin, 22-10-2026: "each person individually, not counting all the time he or
// she gets caught on different cameras"), as ci_entrances_report gives it: a visit runs from the moment any camera in
// the place sees a person until a minute without anyone in view, and counts when an entrance camera saw it. A visit of
// 10 minutes or more is staff (cleaning, refilling) and left out. Its length is the time inside. Two people inside at
// the same moment are one visit: matching people by appearance would take biometrics, deliberately not done.
// No server imports: the pages and the tests share it.

/** How the entrance counts: "line" a line across the door in Protect, "zone" visits seen by the cameras (above). */
export type EntryMethod = "line" | "zone";

export type EntrancesReport = {
  cur_start: string;
  cur_end: string;
  prev_start: string;
  timezone: string;
  /** line_since: the line's first crossing; before it the camera's detections counted. */
  cameras: { camera_id: string; method: EntryMethod; line_since?: string | null }[];
  entries: number;
  prev_entries: number;
  /** Since when every entrance camera counts the way it does now: a line drawn last week makes the count "new since". */
  first_event: string | null;
  by_day: { day: string; visits: number }[];
  by_hour: { hour: number; visits: number }[];
  by_weekday: { weekday: number; visits: number }[];
  /** Visits of 10 minutes or more, left out as staff. */
  staff?: number;
  /** Seconds inside per visit, over the counted visits. */
  stay?: { n: number; p25: number | null; p50: number | null; p75: number | null; mean: number | null };
};

/** Exact only when every entrance camera counts with a line. */
export function entryMethod(report: Pick<EntrancesReport, "cameras">): EntryMethod {
  return report.cameras.length > 0 && report.cameras.every((c) => c.method === "line") ? "line" : "zone";
}

/**
 * When the line took over inside this period (the last camera to get one), so the card can say the days before
 * were counted from detections; null when the whole period was counted one way.
 */
export function lineSinceInPeriod(report: Pick<EntrancesReport, "cameras" | "cur_start">): string | null {
  if (entryMethod(report) !== "line") return null;
  const latest = report.cameras.map((c) => c.line_since ?? null).filter((s): s is string => s !== null).sort().at(-1) ?? null;
  return latest && new Date(latest) > new Date(report.cur_start) ? latest : null;
}

/** People who came in against the period before, or "new since" when counting started after that began. */
export function entriesVerdict(report: Pick<EntrancesReport, "entries" | "prev_entries" | "first_event" | "prev_start">): Verdict {
  return compareSince(report.entries, report.prev_entries, report.first_event, report.prev_start);
}

export type PerVisitor =
  /** No followed terminal is linked to a camera: nothing sold in this place to divide. */
  | { state: "none" }
  /** Fewer than MIN_SALES people or purchases: no average yet. */
  | { state: "tooFew" }
  | { state: "ok"; items: number; revenue: number; perPerson: number; spentPerPerson: number };

/**
 * Purchases per person who came in: what the terminals linked to a camera (the machines in this place) sold,
 * divided by the people who came in, over the same hours. Terminals elsewhere on the Payter account never count.
 * Only from MIN_SALES people and MIN_SALES purchases, so one busy hour never makes the average.
 */
export function perVisitor(report: Pick<EntrancesReport, "entries">, sales: Pick<SalesReport, "terminals"> | null, placeSerials: string[]): PerVisitor {
  const place = new Set(placeSerials);
  const terminals = (sales?.terminals ?? []).filter((t) => place.has(t.serial));
  if (!terminals.length) return { state: "none" };
  const items = terminals.reduce((sum, t) => sum + t.units, 0);
  const revenue = terminals.reduce((sum, t) => sum + t.revenue, 0);
  if (report.entries < MIN_SALES || items < MIN_SALES) return { state: "tooFew" };
  return { state: "ok", items, revenue, perPerson: items / report.entries, spentPerPerson: revenue / report.entries };
}

/** How long people stay inside: the middle visit and the middle half, only from MIN_SALES visits. */
export function timeInside(report: Pick<EntrancesReport, "stay">): { n: number; p25: number; p50: number; p75: number } | null {
  const stay = report.stay;
  if (!stay || stay.n < MIN_SALES || stay.p25 === null || stay.p50 === null || stay.p75 === null) return null;
  return { n: stay.n, p25: stay.p25, p50: stay.p50, p75: stay.p75 };
}
