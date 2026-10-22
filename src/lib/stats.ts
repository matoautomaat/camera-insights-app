// How Camera Insights decides whether a change means something. The same rules as MATO Info, so both
// programs say the same thing about the same numbers. No imports: the pages and the tests share it.
//
// People and sales arrive one at a time, so chance alone makes a count of n wobble by about √n. Real life
// wobbles more: weather, holidays, an empty machine. Measured on MATO's own weekly sales per machine
// (April–September 2026), the week-to-week swing is about four times what pure chance gives, so every count
// here is treated with four times the variance. A change is real when it is more than 1.96 standard
// deviations from nothing — the usual 95% line.

/** Below this many in the two periods together, no conclusion is drawn. */
export const MIN_SALES = 30;
/** Variance relative to pure chance, measured on MATO's data. */
export const DISPERSION = 4;
/** Weekday patterns need every weekday a few times over. */
export const MIN_WEEKS = 4;

const Z95 = 1.96;
/** One-sided 5%/7: the best of seven weekdays has to clear a higher bar. */
const Z_BEST_OF_7 = 2.45;
/** One-sided 5%/24: the busiest or quietest of 24 hours has to clear a higher bar still. */
const Z_BEST_OF_24 = 2.86;

/** "new": the counting only started after the earlier period began. */
export type Verdict = "tooFew" | "new" | "noise" | "up" | "down";

/** Compare two counts over equally long periods. */
export function compareCounts(current: number, previous: number): Verdict {
  if (current + previous < MIN_SALES) return "tooFew";
  const z = (current - previous) / Math.sqrt(DISPERSION * (current + previous));
  return z >= Z95 ? "up" : z <= -Z95 ? "down" : "noise";
}

/**
 * compareCounts, unless the first count came after the earlier period began. That period was then partly
 * empty, and the rise is the start, not growth: a camera set up on 15 September makes October look like +300%.
 */
export function compareSince(current: number, previous: number, first: string | null | undefined, previousStart: string): Verdict {
  if (first && new Date(first) >= new Date(previousStart)) return "new";
  return compareCounts(current, previous);
}

/**
 * The verdict for a change in money. The test counts pieces (it is sales that spread like counts), but money
 * can go the other way when the mix shifts, so the verdict only stands when pieces and money point the same way.
 */
export function compareMoneySince(
  units: number,
  previousUnits: number,
  revenue: number,
  previousRevenue: number,
  first: string | null | undefined,
  previousStart: string,
): Verdict {
  const verdict = compareSince(units, previousUnits, first, previousStart);
  if (verdict !== "up" && verdict !== "down") return verdict;
  return (verdict === "up" && revenue > previousRevenue) || (verdict === "down" && revenue < previousRevenue) ? verdict : "noise";
}

/** The smallest relative change that counts as real when both periods had about n. */
export function detectableChange(n: number): number {
  return (Z95 * Math.sqrt(DISPERSION * 2 * n)) / n;
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** A moment as the calendar day it falls on in that time zone ("2026-09-21"); slicing an ISO string reads UTC. */
export function localDay(instant: string | number | Date, timeZone: string): string {
  let format = dayFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormats.set(timeZone, format);
  }
  return format.format(new Date(instant));
}

export type Period = { cur_start: string; cur_end: string; timezone: string };

/** Every calendar day the period covers, in its own time zone. */
export function periodDays(period: Period): string[] {
  const first = localDay(period.cur_start, period.timezone);
  const last = localDay(new Date(period.cur_end).getTime() - 1, period.timezone);
  const days: string[] = [];
  for (let d = new Date(`${first}T00:00:00Z`); d <= new Date(`${last}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** Monday = 1 … Sunday = 7. */
export const isoWeekday = (day: string) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

export type WeekdayStat = { weekday: number; days: number; count: number; average: number };

/** A count per weekday as an average per such day. Totals would be unfair: a month can hold five Mondays and four Sundays. */
export function weekdayStats(period: Period, byWeekday: { weekday: number; count: number }[]): WeekdayStat[] {
  const days = periodDays(period);
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
    const n = days.filter((d) => isoWeekday(d) === weekday).length;
    const count = byWeekday.find((w) => w.weekday === weekday)?.count ?? 0;
    return { weekday, days: n, count, average: n ? count / n : 0 };
  });
}

/**
 * The weekday that really draws more than the others, if there is one: every weekday seen at least MIN_WEEKS
 * times, and its count clearly above what an ordinary day would give in the same number of days, with the bar
 * raised for picking the best of seven (Bonferroni, 5%/7).
 */
export function busiestWeekday(stats: WeekdayStat[]): number | null {
  if (stats.length !== 7 || stats.some((s) => s.days < MIN_WEEKS)) return null;
  const totalDays = stats.reduce((sum, s) => sum + s.days, 0);
  const total = stats.reduce((sum, s) => sum + s.count, 0);
  if (total < MIN_SALES * 2) return null;
  const best = [...stats].sort((a, b) => b.average - a.average)[0];
  const expected = (total * best.days) / totalDays;
  return (best.count - expected) / Math.sqrt(DISPERSION * expected) >= Z_BEST_OF_7 ? best.weekday : null;
}

/**
 * The hour of the day that really draws more than an ordinary hour, and the one that really draws fewer, if
 * there are such hours: at least a week of days, each judged against an even spread over the 24 hours, with the
 * bar raised for picking the most extreme of 24 (Bonferroni). Counts per hour of the day, summed over the period.
 */
export function standoutHours(byHour: number[], days: number): { busiest: number | null; quietest: number | null } {
  const total = byHour.reduce((sum, n) => sum + n, 0);
  if (days < 7 || total < MIN_SALES * 2 || byHour.length !== 24) return { busiest: null, quietest: null };
  const expected = total / 24;
  const spread = Math.sqrt(DISPERSION * expected);
  const busiest = byHour.indexOf(Math.max(...byHour));
  const quietest = byHour.indexOf(Math.min(...byHour));
  return {
    busiest: (byHour[busiest] - expected) / spread >= Z_BEST_OF_24 ? busiest : null,
    quietest: (byHour[quietest] - expected) / spread <= -Z_BEST_OF_24 ? quietest : null,
  };
}

/**
 * Where a share out of n most likely really lies: the 95% interval, four times wider than chance alone. A share
 * of visitors who bought, out of 40 visits, is a wide range, and saying so is the point.
 */
export function shareInterval(part: number, total: number): { low: number; high: number } {
  if (total <= 0) return { low: 0, high: 1 };
  const share = part / total;
  const margin = Z95 * Math.sqrt((DISPERSION * share * (1 - share)) / total);
  return { low: Math.max(0, share - margin), high: Math.min(1, share + margin) };
}
