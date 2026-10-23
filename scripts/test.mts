// The app's own logic, without UniFi, Payter or a database. Run: npm test
import { liveInterval, retryAfterMs, sharing } from "@/lib/camera-pace";
import { fmt, localeFrom, makeFormat } from "@/i18n/format";
import { isSalesSource, payterAccounts, saleRow, salesSource, terminalOnline, terminalRow } from "@/lib/payter";
import { eventsQuery, parseProtectEvents } from "@/lib/protect-events";
import { salesTotal, salesVerdict, type SalesReport, type TerminalSales } from "@/lib/sales";
import { sessionExpiry, shouldRenew, signSession } from "@/lib/session";
import { busiestWeekday, compareCounts, compareSince, periodDays, shareInterval, standoutHours, weekdayStats } from "@/lib/stats";
import { entriesVerdict, entryMethod, lineSinceInPeriod, perVisitor, timeInside } from "@/lib/entrances";
import { buying, cameraCheck, middleStay, visitDays, type CameraVisitors, type VisitorsReport } from "@/lib/visitors";

let failed = 0;
const ok = (name: string, cond: boolean) => {
  console.log(cond ? "ok  " : "FAIL", name);
  if (!cond) failed++;
};

// ── Protect events ────────────────────────────────────────────────────────────
const now = Date.UTC(2026, 9, 22, 12);
const parsed = parseProtectEvents(
  [
    { id: "a", type: "smartDetectZone", camera: "cam1", start: now - 60_000, end: now - 30_000, smartDetectTypes: ["person"], score: 87.4, thumbnail: "x", description: "a man" },
    { id: "b", type: "smartDetectLine", camera: { id: "cam2" }, start: now - 10_000, smartDetectTypes: ["person"] },
    { id: "c", type: "motion", camera: "cam1", start: now - 5_000 },
    { id: "d", type: "smartDetectZone", camera: "cam1", start: 1_700_000 },
    { id: "e", type: "smartDetectLoiterZone", camera: "cam1", start: now - 1_000, end: now - 2_000 },
  ],
  now,
);
ok("events: zone, line and loiter kept, motion and a seconds timestamp dropped", parsed.events.map((e) => e.eventId).join() === "a,b,e");
ok("events: nothing but camera, kind, times, objects, score and counts", Object.keys(parsed.events[0]).sort().join() === "cameraId,endedAt,eventId,kind,lineDetail,objects,people,score,startedAt" && parsed.events[0].lineDetail === null);
const group = parseProtectEvents(
  [{
    id: "g", type: "smartDetectZone", camera: "cam1", start: now - 20_000, end: now - 5_000, smartDetectTypes: ["person"], smartDetectEvents: ["s1", "s2"],
    metadata: { detectedThumbnails: [{ type: "person", croppedId: "c1", attributes: { color: "blue" } }, { type: "person", croppedId: "c2" }, { type: "vehicle", croppedId: "c3" }], count: { in: 1, "a b": 4 } },
  }],
  now,
).events[0].people;
ok("events: how many people a detection held, as numbers", group.personThumbnails === 2 && group.thumbnails === 3 && group.subEvents === 2 && group.count.in === 1 && !("a b" in group.count));
ok("events: the people count keeps no picture or id", !/c1|c2|c3|s1|blue|croppedId/.test(JSON.stringify(group)));
const crossing = parseProtectEvents(
  [{
    id: "l", type: "smartDetectLine", camera: "cam2", start: now - 5_000, smartDetectTypes: ["person"], thumbnail: "e-123", description: "a woman in a red coat",
    metadata: {
      lineCrossing: { direction: "IN", lineId: "abc123", label: "a woman walking in" },
      detectedThumbnails: [{ croppedId: "t1", type: "person", attributes: { color: "red", direction: "left" } }],
      zonesStatus: { "1": { level: 3 } },
      count: { in: 2, out: 3 },
    },
  }],
  now,
).events[0].lineDetail;
ok("events: a line crossing keeps which way and which line", crossing?.found["metadata.lineCrossing.direction"] === "IN" && crossing?.found["metadata.lineCrossing.lineId"] === "abc123" && crossing?.keys.join() === "count,lineCrossing,zonesStatus" && crossing?.found["metadata.count.in"] === 2 && crossing?.found["metadata.count.out"] === 3);
ok("events: a line crossing keeps no picture, description or person", crossing !== null && !/red|woman|t1|e-123|croppedId|left/.test(JSON.stringify(crossing)));
ok("events: camera as object", parsed.events[1].cameraId === "cam2");
ok("events: an end before the start is no end", parsed.events[2].endedAt === null);
ok("events: every item counts for a full page", parsed.received === 5);
ok("events: newest start, of the readable ones", parsed.lastStart === now - 1_000);
ok("events: data wrapper read too", parseProtectEvents({ data: [{ id: "z", type: "smartDetectZone", camera: "c", start: now }] }, now).events.length === 1);
const q = new URLSearchParams(eventsQuery(now - 1000, now, 500));
ok("events query: milliseconds, every type, oldest first, persons", q.get("start") === String(now - 1000) && q.getAll("types").length === 3 && q.get("orderDirection") === "ASC" && q.get("smartDetectTypes") === "person" && q.get("offset") === "500");

// ── Payter ────────────────────────────────────────────────────────────────────
const sale = saleRow({ id: "p1", serialNumber: "APO1", committedAmount: 350, itemRef: "35", disposition: "APPROVED", txnTimestamp: "2026-10-22T10:00:00Z", maskedPAN: "1234********5678", cardHolder: "X" });
ok("payter: a sale in euros, approved, with its selection", sale?.amount === 3.5 && sale.approved && sale.item_ref === "35" && sale.serial === "APO1");
ok("payter: never the card", sale !== null && !Object.keys(sale).some((key) => /pan|card/i.test(key)) && !JSON.stringify(sale).includes("5678"));
const declined = saleRow({ id: "p2", serialNumber: "APO1", committedAmount: 0, requestedAmount: 350, disposition: "DECLINED", txnTimestamp: "2026-10-22T10:01:00Z", itemRef: "[]" });
ok("payter: a declined payment is 0 and not approved, no selection from []", declined?.amount === 0 && !declined.approved && declined.item_ref === null);
ok("payter: no serial is no sale", saleRow({ id: "p3", committedAmount: 100, txnTimestamp: "2026-10-22T10:00:00Z" }) === null);
const term = terminalRow({ serialNumber: "APO1", model: { name: "P68" }, data: { "Site Reference": "MATO", "Last Connect Date": "2026-10-22T03:00:00Z", "Last Disconnect Date": "2026-10-22T02:59:00Z" } });
ok("payter: terminal read", term?.serial === "APO1" && term.model === "P68" && term.site === "MATO");
ok("payter: up when connected after the last disconnect", term !== null && terminalOnline(term) && !terminalOnline({ lastConnect: "2026-10-22T01:00:00Z", lastDisconnect: "2026-10-22T02:00:00Z" }));

const accounts = payterAccounts({ PAYTER_USERNAME: "a", PAYTER_PASSWORD: "p", PAYTER_DOMAIN: "d", PAYTER_2_USERNAME: "b", PAYTER_2_PASSWORD: "q", PAYTER_2_DOMAIN: "e", PAYTER_3_USERNAME: "c" });
ok("payter: two accounts, an incomplete third left out", accounts.length === 2 && accounts[1].id === 2 && accounts[1].domain === "e");
ok("payter: the first account keeps its old progress name", salesSource(accounts[0]) === "payter" && salesSource(accounts[1]) === "payter:2");
ok("payter: sales sources recognised, terminals not", isSalesSource("payter") && isSalesSource("payter:2") && !isSalesSource("payter-terminals:2"));

// ── Stats ─────────────────────────────────────────────────────────────────────
ok("stats: under 30 no verdict", compareCounts(20, 5) === "tooFew");
ok("stats: 100 vs 90 is noise", compareCounts(100, 90) === "noise");
ok("stats: 200 vs 100 is up", compareCounts(200, 100) === "up");
ok("stats: started after the earlier period began is new", compareSince(200, 10, "2026-10-10T00:00:00Z", "2026-10-01T00:00:00Z") === "new");
ok("stats: share interval is wide on 40", (() => { const r = shareInterval(20, 40); return r.low < 0.25 && r.high > 0.75; })());
const flat = Array.from({ length: 24 }, () => 10);
ok("stats: an even day has no standout hour", standoutHours(flat, 28).busiest === null && standoutHours(flat, 28).quietest === null);
const peaked = flat.map((n, h) => (h === 18 ? 120 : n));
ok("stats: a real evening peak stands out", standoutHours(peaked, 28).busiest === 18);
ok("stats: under a week no standout", standoutHours(peaked, 6).busiest === null);
const period = { cur_start: "2026-09-27T22:00:00Z", cur_end: "2026-10-25T21:59:00Z", timezone: "Europe/Brussels" };
ok("stats: period days in Brussels", periodDays(period)[0] === "2026-09-28" && periodDays(period).length === 28);
const evenWeek = weekdayStats(period, [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, count: 40 })));
ok("stats: even weekdays have no busiest", busiestWeekday(evenWeek) === null);
const fridays = weekdayStats(period, [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, count: weekday === 5 ? 160 : 40 })));
ok("stats: Friday at four times the rest is the busiest", busiestWeekday(fridays) === 5);

// ── Visitors ──────────────────────────────────────────────────────────────────
const cam = (over: Partial<CameraVisitors>): CameraVisitors => ({
  camera_id: "c",
  visits: 0,
  prev_visits: 0,
  long_stays: 0,
  long_list: [],
  first_event: "2026-06-01T00:00:00Z",
  last_event: null,
  events_24h: 0,
  lines: 0,
  prev_lines: 0,
  loiters: 0,
  by_day: [],
  by_hour: [],
  by_weekday: [],
  duration: { n: 0, p25: null, p50: null, p75: null },
  sales: null,
  ...over,
});
const report = (cameras: CameraVisitors[]): VisitorsReport => ({ ...period, prev_start: "2026-08-30T22:00:00Z", cameras });
ok("buying: no terminal, none", buying(cam({ visits: 100 })).state === "none");
ok("buying: too few sales", buying(cam({ visits: 100, sales: { total: 10, seen: 10, bought: 8, attributed: 10 } })).state === "tooFew");
ok("buying: a camera that misses sales says so", buying(cam({ visits: 200, sales: { total: 100, seen: 70, bought: 60, attributed: 65 } })).state === "missed");
const b = buying(cam({ visits: 200, sales: { total: 100, seen: 95, bought: 80, attributed: 95 } }));
ok("buying: share, range and items per buyer", b.state === "ok" && b.share === 0.4 && b.low < 0.4 && b.high > 0.4 && Math.abs(b.perBuyer - 95 / 80) < 1e-9 && b.lookedOnly === 120);
ok("stay: only from 30 visits with an end", middleStay(cam({ duration: { n: 29, p25: 1, p50: 2, p75: 3 } })) === null && middleStay(cam({ duration: { n: 30, p25: 1, p50: 2, p75: 3 } }))?.p50 === 2);
ok("check: offline first", cameraCheck({ online: false, detects: [] }, undefined) === "offline");
ok("check: detection off", cameraCheck({ online: true, detects: ["vehicle"] }, cam({ events_24h: 5 })) === "detectionOff");
ok("check: nobody in 24 h", cameraCheck({ online: true, detects: ["person"] }, cam({ events_24h: 0 })) === "nothingToday");
ok("check: fine", cameraCheck({ online: true, detects: ["person"] }, cam({ events_24h: 3 })) === "fine");
ok("visit days: every day, zeros too", visitDays(cam({ by_day: [{ day: "2026-10-01", visits: 4 }] }), report([])).length === 28);

// ── Entrances ─────────────────────────────────────────────────────────────────
ok("entrances: exact only when every entrance camera has a line", entryMethod({ cameras: [{ camera_id: "a", method: "line" }] }) === "line" && entryMethod({ cameras: [{ camera_id: "a", method: "line" }, { camera_id: "b", method: "zone" }] }) === "zone" && entryMethod({ cameras: [] }) === "zone");
ok("entrances: a line drawn after the earlier period began is new, not growth", entriesVerdict({ entries: 400, prev_entries: 10, first_event: "2026-10-20T00:00:00Z", prev_start: "2026-10-15T00:00:00Z" }) === "new");
ok("entrances: a line drawn inside the period is named, one drawn before it is not", lineSinceInPeriod({ cur_start: "2026-10-01T00:00:00Z", cameras: [{ camera_id: "a", method: "line", line_since: "2026-10-23T00:00:00Z" }] }) === "2026-10-23T00:00:00Z" && lineSinceInPeriod({ cur_start: "2026-10-01T00:00:00Z", cameras: [{ camera_id: "a", method: "line", line_since: "2026-09-01T00:00:00Z" }] }) === null && lineSinceInPeriod({ cur_start: "2026-10-01T00:00:00Z", cameras: [{ camera_id: "a", method: "zone", line_since: null }] }) === null);
const placeSales = { terminals: [{ serial: "T1", units: 60, revenue: 180 }, { serial: "T2", units: 40, revenue: 100 }, { serial: "ELSEWHERE", units: 500, revenue: 2000 }] } as unknown as SalesReport;
const pv = perVisitor({ entries: 200 }, placeSales, ["T1", "T2"]);
ok("entrances: purchases per visitor from this place's machines only", pv.state === "ok" && pv.items === 100 && pv.perPerson === 0.5 && pv.spentPerPerson === 1.4);
ok("entrances: no average per visitor under 30 people or purchases", perVisitor({ entries: 20 }, placeSales, ["T1"]).state === "tooFew" && perVisitor({ entries: 200 }, placeSales, []).state === "none");
ok("entrances: time inside from 30 visits, the middle and the middle half", timeInside({ stay: { n: 31, p25: 65, p50: 156, p75: 231, mean: 174 } })?.p50 === 156 && timeInside({ stay: { n: 12, p25: 65, p50: 156, p75: 231, mean: 174 } }) === null && timeInside({}) === null);
ok("entrances: compared like the rest", entriesVerdict({ entries: 300, prev_entries: 150, first_event: "2026-06-01T00:00:00Z", prev_start: "2026-10-15T00:00:00Z" }) === "up");

// ── Sales ─────────────────────────────────────────────────────────────────────
const term1 = (over: Partial<TerminalSales>): TerminalSales => ({
  serial: "A",
  units: 0,
  revenue: 0,
  prev_units: 0,
  prev_revenue: 0,
  declined: 0,
  first_sale: "2026-01-01T00:00:00Z",
  last_sale: null,
  by_day: [],
  by_hour: [],
  by_weekday: [],
  items: [],
  ...over,
});
const sales = (terminals: TerminalSales[]): SalesReport => ({ ...period, prev_start: "2026-08-30T22:00:00Z", terminals });
ok("sales: pieces up and money up is up", salesVerdict(term1({ units: 300, prev_units: 150, revenue: 900, prev_revenue: 450 }), sales([])) === "up");
ok("sales: pieces up but money down is noise", salesVerdict(term1({ units: 300, prev_units: 150, revenue: 400, prev_revenue: 450 }), sales([])) === "noise");
const all = salesTotal(
  sales([
    term1({ serial: "A", units: 100, prev_units: 95, revenue: 300, prev_revenue: 290, by_day: [{ day: "2026-10-01", units: 4, revenue: 12 }] }),
    term1({ serial: "B", units: 200, prev_units: 0, revenue: 700, first_sale: "2026-10-10T00:00:00Z", by_day: [{ day: "2026-10-01", units: 1, revenue: 3 }] }),
  ]),
);
ok("sales total: sums everything", all.units === 300 && all.revenue === 1000);
ok("sales total: a new terminal is not growth", all.verdict === "noise" && all.compared.units === 100);
ok("sales total: days merged", all.by_day.length === 1 && all.by_day[0].units === 5 && all.by_day[0].revenue === 15);

// ── Camera pace ───────────────────────────────────────────────────────────────
ok("pace: quiet minute every 3 s, fuller slower", liveInterval(0) === 3000 && liveInterval(35) === 5000 && liveInterval(50) === 8000);
ok("pace: Retry-After in seconds, capped, default", retryAfterMs("5") === 5000 && retryAfterMs("600") === 60_000 && retryAfterMs(null) === 10_000);
let calls = 0;
let clockNow = 0;
const shared = sharing((k: string) => k, async () => ++calls, () => clockNow);
const one = await shared("x");
const two = await shared("x");
clockNow = 3000;
const three = await shared("x");
ok("pace: one photo shared within 2.5 s, a new one after", one.value === 1 && two.shared && two.value === 1 && three.value === 2 && !three.shared);

// ── Session ───────────────────────────────────────────────────────────────────
process.env.APP_PASSWORD = "test-password";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
const session = await signSession(Date.now());
ok("session: a fresh cookie is valid", (await sessionExpiry(session.value)) === session.expires.getTime());
ok("session: a changed signature is not", (await sessionExpiry(session.value.slice(0, -2) + "xx")) === null);
ok("session: a changed date is not", (await sessionExpiry(`${Number(session.value.split(".")[0]) + 1}.${session.value.split(".")[1]}`)) === null);
ok("session: run out is not", (await sessionExpiry(session.value, session.expires.getTime() + 1)) === null);
process.env.APP_PASSWORD = "another-password";
ok("session: a new password logs everyone out", (await sessionExpiry(session.value)) === null);
ok("session: renewed in its last 30 days only", !shouldRenew(Date.now() + 40 * 86_400_000) && shouldRenew(Date.now() + 20 * 86_400_000));

// ── Texts and formats ─────────────────────────────────────────────────────────
ok("fmt fills in", fmt("{n} a day", { n: 3 }) === "3 a day" && fmt("{x}", {}) === "{x}");
ok("locale: cookie first, then browser, Dutch by default", localeFrom("en", "nl-BE") === "en" && localeFrom(undefined, "en-US,en") === "en" && localeFrom(undefined, "fr-BE") === "nl");
ok("format: euros the Belgian way", makeFormat("nl").euro(1234.5).replace(/\s/g, " ") === "€ 1.234,50");

const { en } = await import("@/i18n/en");
const { nl } = await import("@/i18n/nl");
const keys = (o: unknown, prefix = ""): string[] =>
  o && typeof o === "object" && !Array.isArray(o) ? Object.entries(o).flatMap(([k, v]) => keys(v, `${prefix}${k}.`)) : [prefix];
ok("texts: Dutch has exactly the English keys", keys(en).sort().join() === keys(nl).sort().join());

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exitCode = 1;
} else console.log("\nall passed");
