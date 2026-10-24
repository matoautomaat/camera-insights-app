import Link from "next/link";
import { after } from "next/server";
import { Cctv, TriangleAlert } from "lucide-react";
import { CameraWall } from "@/components/camera-wall";
import { SalesDrops } from "@/components/sales-drops";
import { FetchNow } from "@/components/fetch-now";
import { SyncLine } from "@/components/sync-line";
import { Change, Dot, Empty, PageHeader, PeriodLinks, Section, Stat } from "@/components/ui";
import { durationText, fmt } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { requireLogin } from "@/lib/auth";
import { salesDrops } from "@/lib/alerts";
import { DEMO, getCameras, getEntrancesReport, getMachinePace, getSalesReport, getSyncStates, getTerminals, getVisitorsReport } from "@/lib/data";
import { entriesVerdict, entryMethod, lineSinceInPeriod, timeInside, visitSales } from "@/lib/entrances";
import { payterConfigured } from "@/lib/payter";
import { salesTotal } from "@/lib/sales";
import { runSync } from "@/lib/sync";
import { unifiConfigured } from "@/lib/unifi";
import { cameraCheck, DAYS_BACK, parsePeriod, PERIODS, visitsVerdict } from "@/lib/visitors";

/** Reading UniFi and Payter after the page can take a few calls of a few seconds each. */
export const maxDuration = 60;

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireLogin();
  const { m, f } = await getI18n();
  const period = parsePeriod((await searchParams).period, "today");
  const days = PERIODS[period];
  const back = DAYS_BACK[period];
  const [cameras, terminals, sync] = await Promise.all([getCameras(), getTerminals(), getSyncStates()]);
  const shown = cameras.filter((c) => !c.hidden);
  const followed = terminals.filter((t) => t.followed);
  const entranceCameras = shown.filter((c) => c.entrance);
  const [visitors, sales, entries, pace] = await Promise.all([
    getVisitorsReport(shown.map((c) => c.cameraId), days, back),
    getSalesReport(followed.map((t) => t.serial), days, back),
    getEntrancesReport(entranceCameras.map((c) => c.cameraId), days, back),
    getMachinePace(followed.map((t) => t.serial)),
  ]);
  // Whatever is due is read after the page, never before it.
  if (!DEMO) after(() => runSync());

  const method = entries ? entryMethod(entries) : null;
  const lineSince = entries ? lineSinceInPeriod(entries) : null;
  const inside = entries ? timeInside(entries) : null;
  // Visitors and sales of the place: its machines are the followed terminals a camera of it looks at (ci_entrances_report).
  const visit = entries ? visitSales(entries) : null;
  const terminalLabel = new Map(terminals.map((t) => [t.serial, t.label]));
  const machineNames = (entries?.machines ?? []).map((serial) => terminalLabel.get(serial) ?? serial).join(", ");
  const hours = entries?.hours ?? [];
  const busiestHour = Math.max(1, ...hours.map((h) => h.visits));
  const countingSince = entries?.first_event && new Date(entries.first_event) > new Date(entries.cur_start) ? entries.first_event : null;
  const doorNames = entranceCameras.map((c) => c.name).join(", ");
  const money = sales ? salesTotal(sales) : null;
  const compareLabel = m.common.compare[period];
  const hiddenCount = cameras.length - shown.length;
  // Reading the consoles failed: a refused key (401/403) is a setup step, anything else is shown as it came.
  const unifiError = sync.find((s) => s.source === "consoles")?.lastError ?? null;
  const keyRefused = unifiError ? /\b(401|403)\b/.test(unifiError) : false;

  return (
    <>
      <PageHeader
        title={m.overview.title}
        subtitle={m.overview.subtitle}
        actions={
          <>
            <SyncLine states={sync} m={m} f={f} />
            <FetchNow />
          </>
        }
      />

      <div className="flex flex-col gap-8">
        <SalesDrops drops={salesDrops(pace)} names={new Map(terminals.map((t) => [t.serial, t.label]))} m={m} f={f} />
        <PeriodLinks hrefFor={(key) => (key === "today" ? "/" : `/?period=${key}`)} current={period} labels={m.common.periods} />

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Everyone who came in, once: only the entrance cameras count, never every camera added up. */}
          <section className="card px-5 py-5 sm:px-6">
            <p className="text-[14px] font-semibold text-muted">{m.overview.entries}</p>
            {entries ? (
              <>
                <p className="mt-1 text-[40px] font-bold leading-none tracking-[-0.03em]">{f.number(entries.entries)}</p>
                <div className="mt-2">
                  <Change
                    verdict={entriesVerdict(entries)}
                    current={entries.entries}
                    previous={entries.prev_entries}
                    first={entries.first_event}
                    label={compareLabel}
                    m={m}
                    f={f}
                  />
                </div>
                {inside && (
                  <div className="mt-3">
                    <Stat
                      label={m.overview.timeInside}
                      value={durationText(inside.p50, m)}
                      detail={fmt(m.camera.stayedHint, { low: durationText(inside.p25, m), high: durationText(inside.p75, m) })}
                    />
                  </div>
                )}
                <p className="mt-3 text-[12.5px] leading-snug text-muted">
                  {lineSince
                    ? fmt(m.overview.entriesLineSince, { cameras: doorNames, date: f.dayMonth(lineSince) })
                    : fmt(method === "line" ? m.overview.entriesLine : m.overview.entriesZone, { cameras: doorNames })}
                </p>
                {(entries.staff ?? 0) > 0 && (
                  <p className="mt-2 text-[12.5px] leading-snug text-muted">{fmt(m.overview.staffLeftOut, { n: f.number(entries.staff ?? 0) })}</p>
                )}
              </>
            ) : (
              <p className="mt-2 text-[14px] text-muted">
                {!unifiConfigured() && !DEMO ? m.overview.noKeyHint : shown.length ? m.overview.entriesNone : m.overview.noCamerasHint}
              </p>
            )}
          </section>
          <section className="card px-5 py-5 sm:px-6">
            <p className="text-[14px] font-semibold text-muted">{m.overview.sales}</p>
            {money ? (
              <>
                <p className="mt-1 text-[40px] font-bold leading-none tracking-[-0.03em]">{f.euro(money.revenue)}</p>
                <div className="mt-2">
                  <Change verdict={money.verdict} current={money.compared.units} previous={money.compared.previous} first={sales?.terminals.map((t) => t.first_sale).filter(Boolean).sort()[0] ?? null} label={compareLabel} m={m} f={f} />
                </div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
                  <Stat label={m.sales.items} value={f.number(money.units)} />
                  {money.units > 0 && <Stat label={m.sales.perItem} value={f.euro(money.revenue / money.units)} />}
                </div>
                <p className="mt-3 text-[12.5px] text-muted">{m.overview.salesHint}</p>
              </>
            ) : (
              <p className="mt-2 text-[14px] text-muted">{payterConfigured() || DEMO ? m.overview.noFollowed : m.overview.noPayter}</p>
            )}
          </section>
        </div>

        {/* Visitors and sales together: who bought, and what sells at which hour. Counts, never a ranking claim. */}
        {visit && (
          <Section
            title={m.overview.visitSales}
            hint={visit.state === "ok" ? fmt(m.overview.visitSalesHint, { terminals: machineNames }) : undefined}
          >
            {visit.state === "none" ? (
              <div className="card px-5 py-5 text-[14px] text-muted sm:px-6">{m.overview.visitSalesNone}</div>
            ) : (
              <div className="card flex flex-col gap-6 px-5 py-5 sm:px-6">
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
                  <Stat label={m.overview.visitors} value={f.number(visit.visits)} />
                  <Stat
                    label={m.overview.boughtSomething}
                    value={fmt(m.overview.boughtOf, { n: f.number(visit.bought), total: f.number(visit.visits) })}
                    detail={
                      visit.share
                        ? `${f.percent(visit.share.share)} · ${fmt(m.camera.boughtRange, { low: f.percent(visit.share.low), high: f.percent(visit.share.high) })}`
                        : `${m.overview.boughtNothing}: ${f.number(visit.visits - visit.bought)}`
                    }
                  />
                  <Stat label={m.overview.salesCount} value={f.number(visit.sales)} detail={f.euro(visit.revenue)} />
                  <Stat
                    label={m.overview.perVisitorItems}
                    value={visit.perVisit ? f.number(Math.round(visit.perVisit.items * 100) / 100) : "–"}
                    detail={visit.perVisit ? `${m.overview.perVisitorSpent}: ${f.euro(visit.perVisit.euros)}` : m.overview.perVisitorTooFew}
                  />
                </div>
                {(visit.unseen > 0 || countingSince) && (
                  <div className="flex flex-col gap-1 text-[12.5px] leading-snug text-muted">
                    {countingSince && <p>{fmt(m.overview.since, { date: f.dayMonth(countingSince) })}</p>}
                    {visit.unseen > 0 && <p>{fmt(m.overview.unseen, { n: f.number(visit.unseen) })}</p>}
                  </div>
                )}
                <div>
                  <h3 className="text-[15px] font-semibold">{m.overview.perHour}</h3>
                  <p className="text-[12.5px] text-muted">{m.overview.perHourHint}</p>
                  {hours.length === 0 ? (
                    <p className="mt-3 text-[14px] text-muted">{m.overview.noHours}</p>
                  ) : (
                    <ul className="mt-2 flex flex-col divide-y divide-line">
                      {hours.map((h) => (
                        <li key={h.hour} className="grid grid-cols-[3.25rem_1fr] gap-3 py-2.5">
                          <span className="text-[14px] font-semibold tabular-nums">{String(h.hour).padStart(2, "0")}:00</span>
                          <div className="min-w-0">
                            <p className="text-[14px]">
                              {fmt(m.overview.hourLine, { visitors: f.number(h.visits), bought: f.number(h.bought), sales: f.number(h.sales) })}
                            </p>
                            {/* The bar is the visitors of that hour against the busiest hour; its dark part bought something. */}
                            <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-surface" aria-hidden>
                              <span className="flex h-full rounded-full bg-bar" style={{ width: `${(h.visits / busiestHour) * 100}%` }}>
                                <span className="h-full rounded-full bg-bar-strong" style={{ width: h.visits > 0 ? `${(Math.min(h.bought, h.visits) / h.visits) * 100}%` : "0%" }} />
                              </span>
                            </span>
                            {h.top.length > 0 && (
                              <p className="mt-1.5 text-[12.5px] leading-snug text-muted">
                                {fmt(m.overview.topSold, {
                                  list: h.top
                                    .map((item) =>
                                      fmt(m.overview.timesSold, {
                                        name: `${terminalLabel.get(item.serial) ?? item.serial} · ${item.item_ref === "?" ? m.sales.noSelection : fmt(m.sales.selection, { ref: item.item_ref })}`,
                                        n: f.number(item.units),
                                      }),
                                    )
                                    .join(", "),
                                })}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </Section>
        )}

        <Section
          title={m.overview.cameras}
          hint={[m.overview.camerasHint, hiddenCount > 0 ? fmt(m.overview.hiddenCount, { n: hiddenCount }) : null].filter(Boolean).join(" · ")}
        >
          {!unifiConfigured() && !DEMO ? (
            <Empty title={m.overview.noKey} hint={m.overview.noKeyHint} icon={<Cctv className="size-5" />} />
          ) : shown.length === 0 && unifiError ? (
            <Empty
              title={keyRefused ? m.overview.keyRefused : m.overview.noCameras}
              hint={keyRefused ? m.overview.keyRefusedHint : fmt(m.overview.unifiFailed, { error: unifiError.slice(0, 120) })}
              icon={<Cctv className="size-5" />}
            />
          ) : shown.length === 0 ? (
            <Empty title={m.overview.noCameras} hint={m.overview.noCamerasHint} icon={<Cctv className="size-5" />} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((camera) => {
                const seen = visitors?.cameras.find((c) => c.camera_id === camera.cameraId);
                const check = cameraCheck(camera, seen);
                const warning =
                  check === "offline" ? m.camera.checkOffline : check === "detectionOff" ? m.camera.checkOff : check === "nothingToday" ? m.camera.checkNothing : null;
                return (
                  <Link
                    key={camera.cameraId}
                    href={`/cameras/${encodeURIComponent(camera.cameraId)}${period === "today" ? "" : `?period=${period}`}`}
                    className="card flex flex-col gap-3 px-5 py-5 transition-colors hover:border-accent"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[16px] font-semibold">{camera.name}</p>
                        <p className="truncate text-[13px] text-muted">{[camera.model, camera.consoleName].filter(Boolean).join(" · ")}</p>
                      </div>
                      <Dot on={camera.online} label={camera.online ? m.common.online : m.common.offline} />
                    </div>
                    <div>
                      <p className="text-[30px] font-bold leading-none tracking-[-0.02em]">
                        {f.number(seen?.visits ?? 0)} <span className="text-[14px] font-semibold text-muted">{m.overview.visitorsIn}</span>
                      </p>
                      {seen && visitors && (
                        <div className="mt-1.5">
                          <Change
                            verdict={visitsVerdict(seen, visitors)}
                            current={seen.visits}
                            previous={seen.prev_visits}
                            first={seen.first_event}
                            label={compareLabel}
                            m={m}
                            f={f}
                          />
                        </div>
                      )}
                    </div>
                    <p className="text-[13px] text-muted">{seen?.last_event ? fmt(m.overview.lastSeen, { time: f.dateTime(seen.last_event) }) : m.overview.noneSeen}</p>
                    {warning && (
                      <p className="flex items-start gap-1.5 text-[13px] font-medium text-warn">
                        <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
                        {warning}
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </Section>

        {shown.length > 0 && <CameraWall cameras={shown.map((c) => ({ id: c.cameraId, name: c.name }))} />}
      </div>
    </>
  );
}
