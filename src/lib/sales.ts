import {
  busiestWeekday,
  compareMoneySince,
  MIN_WEEKS,
  periodDays,
  standoutHours,
  type Verdict,
  weekdayStats,
  type WeekdayStat,
} from "@/lib/stats";

// What the Payter terminals sold, as ci_sales_report gives it, and what may be said about it. No server imports:
// the pages and the tests share it. Amounts are what customers paid, VAT included.

type Money = { units: number; revenue: number };

export type TerminalSales = {
  serial: string;
  units: number;
  revenue: number;
  prev_units: number;
  prev_revenue: number;
  /** Payments that were declined or failed in the period: not sales, but worth knowing. */
  declined: number;
  first_sale: string | null;
  last_sale: string | null;
  by_day: ({ day: string } & Money)[];
  by_hour: ({ hour: number } & Money)[];
  by_weekday: ({ weekday: number } & Money)[];
  /** Per selection number (Payter's itemRef), most sold first; "?" when Payter gave none. */
  items: ({ item_ref: string } & Money)[];
};

export type SalesReport = {
  cur_start: string;
  cur_end: string;
  prev_start: string;
  timezone: string;
  terminals: TerminalSales[];
};

/** Pieces and money against the period before; "new" when the terminal's first sale came after that began. */
export function salesVerdict(t: Pick<TerminalSales, "units" | "prev_units" | "revenue" | "prev_revenue" | "first_sale">, report: Pick<SalesReport, "prev_start">): Verdict {
  return compareMoneySince(t.units, t.prev_units, t.revenue, t.prev_revenue, t.first_sale, report.prev_start);
}

/** Every day of the period, a day without sales as 0. */
export function salesDays(t: Pick<TerminalSales, "by_day">, report: SalesReport): ({ day: string } & Money)[] {
  const byDay = new Map(t.by_day.map((d) => [d.day, d]));
  return periodDays(report).map((day) => byDay.get(day) ?? { day, units: 0, revenue: 0 });
}

/** Pieces per hour of the day as an average per day, and the hours that really stand out. */
export function salesHours(t: Pick<TerminalSales, "by_hour">, report: SalesReport) {
  const days = periodDays(report).length;
  const counts = Array.from({ length: 24 }, (_, hour) => t.by_hour.find((h) => h.hour === hour)?.units ?? 0);
  return {
    perDay: counts.map((n, hour) => ({ hour, value: days > 0 ? n / days : 0 })),
    ...standoutHours(counts, days),
  };
}

/** Pieces per weekday as an average per such day, and the weekday that really sells more. */
export function salesWeekdays(t: Pick<TerminalSales, "by_weekday">, report: SalesReport): { days: WeekdayStat[]; busiest: number | null; enough: boolean } {
  const days = weekdayStats(report, t.by_weekday.map((w) => ({ weekday: w.weekday, count: w.units })));
  return { days, busiest: busiestWeekday(days), enough: days.every((d) => d.days >= MIN_WEEKS) };
}

export type SalesTotal = Pick<TerminalSales, "units" | "revenue" | "declined" | "by_day" | "by_hour" | "by_weekday" | "last_sale"> & {
  verdict: Verdict;
  /** The pieces weighed by the verdict: only terminals that already sold when the earlier period began. */
  compared: { units: number; previous: number };
};

/**
 * Every terminal summed into one, for the overview. As with the cameras, only terminals that already sold when
 * the earlier period began are compared, so a new terminal never looks like growth.
 */
export function salesTotal(report: SalesReport): SalesTotal {
  const all = report.terminals;
  const settled = all.filter((t) => t.first_sale && new Date(t.first_sale) < new Date(report.prev_start));
  const add = (list: TerminalSales[], key: "units" | "revenue" | "prev_units" | "prev_revenue" | "declined") =>
    list.reduce((total, t) => total + Number(t[key]), 0);
  const merge = <T extends Money, K extends keyof T>(lists: T[][], key: K): T[] => {
    const map = new Map<unknown, T>();
    for (const list of lists)
      for (const row of list) {
        const had = map.get(row[key]);
        map.set(row[key], had ? { ...had, units: had.units + row.units, revenue: had.revenue + Number(row.revenue) } : { ...row, revenue: Number(row.revenue) });
      }
    return [...map.values()];
  };
  const firsts = all.map((t) => t.first_sale).filter((f): f is string => Boolean(f)).sort();
  const lasts = all.map((t) => t.last_sale).filter((f): f is string => Boolean(f)).sort();
  const verdict = settled.length
    ? compareMoneySince(add(settled, "units"), add(settled, "prev_units"), add(settled, "revenue"), add(settled, "prev_revenue"), null, report.prev_start)
    : firsts.length
      ? "new"
      : "tooFew";
  return {
    units: add(all, "units"),
    revenue: add(all, "revenue"),
    declined: add(all, "declined"),
    last_sale: lasts.at(-1) ?? null,
    by_day: merge(all.map((t) => t.by_day), "day"),
    by_hour: merge(all.map((t) => t.by_hour), "hour"),
    by_weekday: merge(all.map((t) => t.by_weekday), "weekday"),
    verdict,
    compared: { units: add(settled, "units"), previous: add(settled, "prev_units") },
  };
}

/**
 * Payter's history is read oldest first: while the watermark is more than a day behind, older days are not
 * complete yet. Gives how far it got, or null when it is up to date.
 */
export function stillReadingUntil(watermark: number | null | undefined, now: number = Date.now()): number | null {
  return watermark && now - watermark > 86_400_000 ? watermark : null;
}
