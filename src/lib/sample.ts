import type { CameraInfo, TerminalInfo } from "@/lib/data";
import type { SalesReport, TerminalSales } from "@/lib/sales";
import { isoWeekday, localDay } from "@/lib/stats";
import type { SyncState } from "@/lib/sync";
import type { CameraVisitors, VisitorsReport } from "@/lib/visitors";

// Made-up figures for trying the screens on a developer's own machine (CI_DEMO=1): four cameras, three
// terminals, busy in the evening and on Fridays, quiet at night. Nothing here is real or read from anywhere.

const TZ = "Europe/Brussels";
const DAY = 86_400_000;

/** A repeatable wobble, so the same page shows the same made-up numbers every time. */
function wobble(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Midnight of a calendar day in Brussels, as an instant. */
function midnight(day: string): Date {
  const guess = new Date(`${day}T00:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, timeZoneName: "shortOffset" })
    .formatToParts(guess)
    .find((p) => p.type === "timeZoneName")?.value.match(/GMT([+-]\d+)/)?.[1];
  return new Date(guess.getTime() - Number(offset ?? 0) * 3_600_000);
}

function window(days: number) {
  const now = new Date();
  const today = localDay(now, TZ);
  const curStart = midnight(new Date(new Date(`${today}T12:00:00Z`).getTime() - (days - 1) * DAY).toISOString().slice(0, 10));
  return {
    cur_start: curStart.toISOString(),
    cur_end: now.toISOString(),
    prev_start: new Date(curStart.getTime() - days * DAY).toISOString(),
    prev_end: new Date(now.getTime() - days * DAY).toISOString(),
    timezone: TZ,
    days: Array.from({ length: days }, (_, i) => new Date(new Date(`${today}T12:00:00Z`).getTime() - (days - 1 - i) * DAY).toISOString().slice(0, 10)),
  };
}

const SHAPE = [1, 0, 0, 0, 0, 1, 3, 5, 6, 5, 5, 8, 12, 7, 6, 7, 11, 16, 19, 14, 11, 7, 4, 2];
const SHAPE_SUM = SHAPE.reduce((a, b) => a + b, 0);
const WEEKDAY = [0.9, 0.85, 0.95, 1, 1.35, 1.2, 0.8];

const CAMERAS = [
  { id: "cam-brood", name: "Automaat brood & drank", model: "G5 Bullet", scale: 70, terminals: ["DEMO-T1"], since: 120 },
  { id: "cam-56", name: "Automaat 5&6", model: "G5 Dome", scale: 38, terminals: ["DEMO-T2"], since: 120 },
  { id: "cam-78", name: "Automaat 7 & 8", model: "G5 Dome", scale: 30, terminals: [], since: 120 },
  { id: "cam-dix", name: "Diksmuide", model: "G5 Bullet", scale: 22, terminals: ["DEMO-T3"], since: 9 },
];

export function sampleCameras(): CameraInfo[] {
  return CAMERAS.map((c, i) => ({
    consoleId: "demo-console",
    consoleName: "Cloud Key (demo)",
    cameraId: c.id,
    name: c.name,
    model: c.model,
    online: i !== 2 || new Date().getMinutes() % 2 === 0,
    detects: i === 2 ? ["vehicle"] : ["person", "vehicle"],
    fullHd: c.model === "G5 Dome" ? false : null,
    hidden: false,
    terminals: c.terminals,
  }));
}

export function sampleTerminals(): TerminalInfo[] {
  return [
    { serial: "DEMO-T1", label: "Brood & drank", name: "Brood & drank", model: "P68", site: "MATO", online: true, followed: true },
    { serial: "DEMO-T2", label: "Automaat 5&6", name: "Automaat 5&6", model: "Apollo", site: "MATO", online: true, followed: true },
    { serial: "DEMO-T3", label: "Diksmuide", name: "Diksmuide", model: "P68", site: "MATO", online: false, followed: true },
    { serial: "DEMO-X9", label: "ZX-0042", name: null, model: "P68", site: "ZX-0042", online: true, followed: false },
  ];
}

/** How many on one day for a camera of that scale, wobbled but steady. */
const dayCount = (scale: number, day: string, seed: number) =>
  Math.round(scale * WEEKDAY[isoWeekday(day) - 1] * (0.8 + 0.4 * wobble(seed + Number(day.replace(/-/g, "")))));

export function sampleVisitors(cameraIds: string[], days: number): VisitorsReport {
  const w = window(days);
  const nowHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));
  const todayShare = SHAPE.slice(0, nowHour + 1).reduce((a, b) => a + b, 0) / SHAPE_SUM;
  const cameras: CameraVisitors[] = cameraIds.map((id) => {
    const index = Math.max(0, CAMERAS.findIndex((x) => x.id === id));
    const c = CAMERAS[index];
    const first = new Date(Date.now() - c.since * DAY);
    const counted = (day: string) => (new Date(`${day}T23:59:59Z`) < first ? 0 : dayCount(c.scale, day, index));
    const byDay = w.days.map((day, i) => ({ day, visits: Math.round(counted(day) * (i === w.days.length - 1 ? todayShare : 1)) }));
    const visits = byDay.reduce((s, d) => s + d.visits, 0);
    const prevDays = w.days.map((d) => new Date(new Date(`${d}T12:00:00Z`).getTime() - days * DAY).toISOString().slice(0, 10));
    const prevVisits = Math.round(prevDays.reduce((s, d, i) => s + counted(d) * (i === prevDays.length - 1 ? todayShare : 1), 0) * 0.92);
    const byHour = SHAPE.map((n, hour) => ({ hour, visits: Math.round((visits * n) / SHAPE_SUM) })).filter((h) => h.visits > 0);
    const byWeekday = [1, 2, 3, 4, 5, 6, 7]
      .map((weekday) => ({ weekday, visits: byDay.filter((d) => isoWeekday(d.day) === weekday).reduce((s, d) => s + d.visits, 0) }))
      .filter((d) => d.visits > 0);
    const salesTotal = c.terminals.length ? Math.round(visits * 0.42) : 0;
    return {
      camera_id: id,
      visits,
      prev_visits: prevVisits,
      long_stays: Math.min(days, 6),
      long_list: Array.from({ length: Math.min(days, 6) }, (_, i) => {
        const start = new Date(midnight(w.days[w.days.length - 1 - i] ?? w.days[0]).getTime() + (6 * 60 + 40 + i * 7) * 60_000);
        return { started_at: start.toISOString(), ended_at: new Date(start.getTime() + (14 + i * 3) * 60_000).toISOString() };
      }).filter((s) => new Date(s.started_at) < new Date()),
      first_event: first.toISOString(),
      last_event: new Date(Date.now() - (4 + index * 11) * 60_000).toISOString(),
      events_24h: index === 2 ? 0 : Math.round(c.scale * 1.1),
      lines: Math.round(visits * 1.5),
      prev_lines: Math.round(prevVisits * 1.4),
      loiters: Math.round(visits / 40),
      by_day: byDay,
      by_hour: byHour,
      by_weekday: byWeekday,
      duration: { n: Math.round(visits * 0.9), p25: 16 + index * 3, p50: 38 + index * 6, p75: 74 + index * 9 },
      sales: c.terminals.length
        ? { total: salesTotal, seen: Math.round(salesTotal * (index === 3 ? 0.71 : 0.96)), bought: Math.round(salesTotal * 0.85), attributed: Math.round(salesTotal * 0.93) }
        : null,
    };
  });
  return { cur_start: w.cur_start, cur_end: w.cur_end, prev_start: w.prev_start, timezone: w.timezone, cameras };
}

const PRICES: Record<string, number> = { "11": 2.5, "12": 2.5, "21": 3.2, "23": 4.5, "35": 3.75, "41": 1.8, "52": 6.5 };

export function sampleSales(serials: string[], days: number): SalesReport {
  const w = window(days);
  const terminals: TerminalSales[] = serials.map((serial, index) => {
    const scale = [32, 18, 9][index] ?? 5;
    const since = index === 2 ? 9 : 200;
    const first = new Date(Date.now() - since * DAY);
    const units = (day: string) => (new Date(`${day}T23:59:59Z`) < first ? 0 : dayCount(scale, day, 7 + index));
    const byDay = w.days.map((day) => {
      const u = units(day);
      return { day, units: u, revenue: Math.round(u * 3.3 * 100) / 100 };
    });
    const total = byDay.reduce((s, d) => s + d.units, 0);
    const revenue = byDay.reduce((s, d) => s + d.revenue, 0);
    const prevUnits = Math.round(total * 0.88);
    const refs = Object.keys(PRICES);
    return {
      serial,
      units: total,
      revenue,
      prev_units: prevUnits,
      prev_revenue: Math.round(prevUnits * 3.25 * 100) / 100,
      declined: Math.round(total / 60),
      first_sale: first.toISOString(),
      last_sale: new Date(Date.now() - (6 + index * 17) * 60_000).toISOString(),
      by_day: byDay,
      by_hour: SHAPE.map((n, hour) => ({ hour, units: Math.round((total * n) / SHAPE_SUM), revenue: Math.round((total * n * 330) / SHAPE_SUM) / 100 })).filter((h) => h.units > 0),
      by_weekday: [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
        const list = byDay.filter((d) => isoWeekday(d.day) === weekday);
        return { weekday, units: list.reduce((s, d) => s + d.units, 0), revenue: list.reduce((s, d) => s + d.revenue, 0) };
      }),
      items: refs
        .map((ref, i) => {
          const u = Math.round((total * [0.24, 0.19, 0.16, 0.13, 0.12, 0.1, 0.06][i]) as number);
          return { item_ref: ref, units: u, revenue: Math.round(u * PRICES[ref] * 100) / 100 };
        })
        .sort((a, b) => b.units - a.units),
    };
  });
  return { cur_start: w.cur_start, cur_end: w.cur_end, prev_start: w.prev_start, timezone: w.timezone, terminals };
}

export function sampleSyncStates(): SyncState[] {
  const run = new Date(Date.now() - 3 * 60_000).toISOString();
  return [
    { source: "consoles", syncedUntil: null, watermark: null, lastRun: run, lastError: null, lastCount: 1 },
    { source: "protect:demo-console", syncedUntil: run, watermark: null, lastRun: run, lastError: null, lastCount: 37 },
    { source: "payter", syncedUntil: run, watermark: Date.now(), lastRun: run, lastError: null, lastCount: 12 },
    { source: "payter-terminals", syncedUntil: null, watermark: null, lastRun: run, lastError: null, lastCount: 4 },
  ];
}
