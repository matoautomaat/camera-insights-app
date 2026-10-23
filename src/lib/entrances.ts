import { compareSince, MIN_SALES, shareInterval, type Verdict } from "@/lib/stats";

// Everyone who comes in, counted once (Xin, 22-10-2026: "each person individually, not counting all the time he or
// she gets caught on different cameras"), as ci_entrances_report gives it: a visit runs from the moment any camera in
// the place sees a person until a minute without anyone in view, and counts when an entrance camera saw it. A visit of
// 10 minutes or more without a sale is staff (cleaning, refilling) and left out; with a sale it is customers. Its length
// is the time inside, leaving out visits of 10 minutes or more (mostly several people one after another). Two people inside at
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
  /** Visits of 10 minutes or more without a sale, left out as staff. */
  staff?: number;
  /** Seconds inside per visit, over the counted visits. */
  stay?: { n: number; p25: number | null; p50: number | null; p75: number | null; mean: number | null };
  /** The followed terminals a camera of the place looks at: the machines of the place. */
  machines?: string[];
  /** Visits during which one of those machines sold something. */
  bought?: number;
  /** What those machines sold in the period, from the first camera data on (first_event). */
  sales?: number;
  revenue?: number;
  /** Sales that fell inside a visit; the rest are a camera missing someone or a machine out of view. */
  sales_seen?: number;
  /** Per hour of the day, added up over the period: only hours with a visit or a sale. */
  hours?: HourRow[];
};

export type HourRow = {
  hour: number;
  visits: number;
  bought: number;
  sales: number;
  revenue: number;
  /** The three most sold selections that hour: counts, not a claim that one really sells better. */
  top: { serial: string; item_ref: string; units: number }[];
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

export type VisitSales =
  /** No followed terminal is linked to a camera of the place: nothing to set against the visits. */
  | { state: "none" }
  | {
      state: "ok";
      visits: number;
      bought: number;
      /** Who bought, out of the visits, with its 95% range: only from MIN_SALES visits. */
      share: { share: number; low: number; high: number } | null;
      sales: number;
      revenue: number;
      /** Purchases and euros per visit: only from MIN_SALES visits and MIN_SALES sales. */
      perVisit: { items: number; euros: number } | null;
      /** Sales that fell outside every visit. */
      unseen: number;
    };

/**
 * Visitors and sales of the place together: how many visits bought something (a sale on one of its machines from 20
 * seconds before the visit until a minute after), and the purchases per visit. Terminals elsewhere on the Payter
 * account never count. Shares and averages only once there are enough visits and sales to mean something.
 */
export function visitSales(report: EntrancesReport): VisitSales {
  if (!report.machines?.length) return { state: "none" };
  const visits = report.entries;
  const bought = Math.min(report.bought ?? 0, visits);
  const sales = report.sales ?? 0;
  const revenue = report.revenue ?? 0;
  return {
    state: "ok",
    visits,
    bought,
    share: visits >= MIN_SALES ? { share: bought / visits, ...shareInterval(bought, visits) } : null,
    sales,
    revenue,
    perVisit: visits >= MIN_SALES && sales >= MIN_SALES ? { items: sales / visits, euros: revenue / visits } : null,
    unseen: Math.max(0, sales - (report.sales_seen ?? sales)),
  };
}

/** How long people stay inside: the middle visit and the middle half, only from MIN_SALES visits. */
export function timeInside(report: Pick<EntrancesReport, "stay">): { n: number; p25: number; p50: number; p75: number } | null {
  const stay = report.stay;
  if (!stay || stay.n < MIN_SALES || stay.p25 === null || stay.p50 === null || stay.p75 === null) return null;
  return { n: stay.n, p25: stay.p25, p50: stay.p50, p75: stay.p75 };
}
