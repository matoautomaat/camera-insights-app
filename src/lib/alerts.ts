import { compareRate } from "@/lib/stats";

// A warning when a machine suddenly sells far less than usual (Xin, 25-10-2026: Brood sold 17 to 21 a day, then 3,
// 3). The last RECENT_HOURS against the four weeks before, by the rules of stats.ts, so a quiet day never raises it.
// No server imports: the pages and the tests share it.

/** How far back "lately" reaches. */
export const RECENT_HOURS = 48;
/** A terminal needs this many days of sales before them before it can be judged. */
export const MIN_BASE_DAYS = 14;

/** One terminal's pace, as ci_machine_pace gives it. */
export type MachinePace = { serial: string; recent: number; base: number; base_days: number; last_sale: string | null };

export type SalesDrop = { serial: string; recent: number; expected: number; lastSale: string | null };

/** The terminals selling far less than usual over the last RECENT_HOURS, most missing first. */
export function salesDrops(pace: MachinePace[], recentHours: number = RECENT_HOURS): SalesDrop[] {
  return pace
    .flatMap((p) => {
      if (p.base_days < MIN_BASE_DAYS) return [];
      const k = recentHours / 24 / p.base_days;
      return compareRate(p.recent, p.base, k) === "down" ? [{ serial: p.serial, recent: p.recent, expected: p.base * k, lastSale: p.last_sale }] : [];
    })
    .sort((a, b) => b.expected - b.recent - (a.expected - a.recent));
}
