import { notFound } from "next/navigation";
import { after } from "next/server";
import { CircleCheck, TriangleAlert, UsersRound } from "lucide-react";
import { CameraViewer } from "@/components/camera-viewer";
import { FetchNow } from "@/components/fetch-now";
import { BarList, Bars, Change, Dot, Empty, HowToRead, PageHeader, Panel, PeriodLinks, Stat } from "@/components/ui";
import type { Messages } from "@/i18n/en";
import { durationText, fmt } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { requireLogin } from "@/lib/auth";
import { DEMO, getCamera, getTerminals, getVisitorsReport } from "@/lib/data";
import { runSync } from "@/lib/sync";
import { buying, cameraCheck, hourProfile, middleStay, parsePeriod, PERIODS, visitDays, visitsVerdict, weekdayProfile } from "@/lib/visitors";

export const maxDuration = 60;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const camera = await getCamera(decodeURIComponent((await params).id));
  return { title: camera?.name ?? "Camera" };
}

const clock = (hour: number) => `${String(hour % 24).padStart(2, "0")}:00`;
const oneDecimal = (value: number) => Math.round(value * 10) / 10;

/** "45 s" or "1 min 20 s". */
export default async function CameraPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ period?: string }> }) {
  await requireLogin();
  const { m, f } = await getI18n();
  const id = decodeURIComponent((await params).id);
  const period = parsePeriod((await searchParams).period, "today");
  const camera = await getCamera(id);
  if (!camera) notFound();
  const [report, terminals] = await Promise.all([getVisitorsReport([camera.cameraId], PERIODS[period]), getTerminals()]);
  if (!DEMO) after(() => runSync());

  const seen = report?.cameras[0];
  const inView = terminals.filter((t) => t.followed && camera.terminals.includes(t.serial));
  const check = cameraCheck(camera, seen);
  const checkText =
    check === "offline"
      ? m.camera.checkOffline
      : check === "detectionOff"
        ? m.camera.checkOff
        : check === "nothingToday"
          ? m.camera.checkNothing
          : fmt(m.camera.checkFine, { n: f.number(seen?.events_24h ?? 0) });
  const base = `/cameras/${encodeURIComponent(camera.cameraId)}`;

  return (
    <>
      <PageHeader
        title={camera.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{[camera.model, camera.consoleName].filter(Boolean).join(" · ")}</span>
            <Dot on={camera.online} label={camera.online ? m.common.online : m.common.offline} />
          </span>
        }
        back={{ href: period === "today" ? "/" : `/?period=${period}`, label: m.camera.back }}
        actions={<FetchNow />}
      />

      <div className="flex flex-col gap-6">
        <CameraViewer cameraId={camera.cameraId} name={camera.name} />

        <PeriodLinks hrefFor={(key) => (key === "today" ? base : `${base}?period=${key}`)} current={period} labels={m.common.periods} />

        {!seen || !report || !seen.first_event ? (
          <Empty title={m.camera.noData} hint={m.camera.noDataHint} icon={<UsersRound className="size-5" />} />
        ) : (
          <CameraFigures camera={seen} report={report} period={period} m={m} f={f} terminalNames={inView.map((t) => t.label)} />
        )}

        <Panel title={m.camera.check}>
          <div className="flex items-start gap-3">
            {check === "fine" ? (
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-up" aria-hidden="true" />
            ) : (
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden="true" />
            )}
            <div className="text-[14px]">
              <p className="font-medium">{checkText}</p>
              <p className="mt-0.5 text-muted">
                {fmt(m.camera.detects, { list: camera.detects.length ? camera.detects.join(", ") : "–" })}
                {seen?.last_event ? ` · ${fmt(m.overview.lastSeen, { time: f.dateTime(seen.last_event) })}` : ""}
              </p>
              {inView.length > 0 && <p className="mt-0.5 text-muted">{fmt(m.camera.terminals, { list: inView.map((t) => t.label).join(", ") })}</p>}
            </div>
          </div>
        </Panel>

        <HowToRead title={m.common.howTitle} lines={[m.camera.how1, m.camera.how2, m.camera.how3, m.camera.how4, m.camera.how5]} />
      </div>
    </>
  );
}

function CameraFigures({
  camera,
  report,
  period,
  m,
  f,
  terminalNames,
}: {
  camera: NonNullable<Awaited<ReturnType<typeof getVisitorsReport>>>["cameras"][number];
  report: NonNullable<Awaited<ReturnType<typeof getVisitorsReport>>>;
  period: keyof typeof PERIODS;
  m: Messages;
  f: Awaited<ReturnType<typeof getI18n>>["f"];
  terminalNames: string[];
}) {
  const days = visitDays(camera, report);
  const hours = hourProfile(camera, report);
  const week = weekdayProfile(camera, report);
  const buy = buying(camera);
  const stay = middleStay(camera);
  const hourLine =
    [
      hours.busiest !== null ? fmt(m.camera.busiestHour, { from: clock(hours.busiest), to: clock(hours.busiest + 1) }) : null,
      hours.quietest !== null ? fmt(m.camera.quietestHour, { from: clock(hours.quietest), to: clock(hours.quietest + 1) }) : null,
    ]
      .filter(Boolean)
      .join(" ") || m.camera.noStandout;
  const boughtDetail =
    buy.state === "ok"
      ? fmt(m.camera.boughtRange, { low: f.percent(buy.low), high: f.percent(buy.high) })
      : buy.state === "missed"
        ? fmt(m.camera.missed, { share: f.percent(buy.seen) })
        : buy.state === "tooFew"
          ? m.camera.tooFew
          : m.camera.noTerminal;
  const hourBars = hours.perDay.map((h) => ({
    key: String(h.hour),
    label: String(h.hour).padStart(2, "0"),
    value: h.value,
    display: period === "today" ? f.number(h.value) : fmt(m.common.perDayValue, { n: f.number(oneDecimal(h.value)) }),
    strong: h.hour === hours.busiest,
  }));

  return (
    <>
      <section className="card px-5 py-5 sm:px-6 sm:py-6">
        <p className="text-[14px] font-semibold text-muted">{m.camera.visits}</p>
        <p className="mt-1 text-[40px] font-bold leading-none tracking-[-0.03em]">{f.number(camera.visits)}</p>
        <div className="mt-2">
          <Change verdict={visitsVerdict(camera, report)} current={camera.visits} previous={camera.prev_visits} first={camera.first_event} label={m.common.compare[period]} m={m} f={f} />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Stat label={m.camera.perDay} value={f.number(oneDecimal(camera.visits / Math.max(days.length, 1)))} />
          <Stat
            label={m.camera.stayed}
            value={stay ? durationText(stay.p50, m) : "–"}
            detail={stay ? fmt(m.camera.stayedHint, { low: durationText(stay.p25, m), high: durationText(stay.p75, m) }) : m.camera.tooFew}
          />
          <Stat label={m.camera.bought} value={buy.state === "ok" ? f.percent(buy.share) : "–"} detail={boughtDetail} />
          <Stat
            label={m.camera.perBuyer}
            value={buy.state === "ok" ? f.number(oneDecimal(buy.perBuyer)) : "–"}
            detail={buy.state === "ok" ? `${m.camera.lookedOnly}: ${f.number(buy.lookedOnly)}` : terminalNames.length ? undefined : m.camera.noTerminal}
          />
        </div>
        <div className="mt-7">
          {period === "today" ? (
            <Bars items={hourBars} labelEvery={3} />
          ) : (
            <Bars
              items={days.map((d) => ({ key: d.day, label: f.dayMonth(`${d.day}T12:00:00Z`), value: d.visits, display: f.number(d.visits) }))}
            />
          )}
        </div>
        {(camera.lines > 0 || camera.loiters > 0) && (
          <p className="mt-4 text-[13.5px] text-muted">
            {[camera.lines > 0 ? `${m.camera.lines}: ${f.number(camera.lines)}` : null, camera.loiters > 0 ? `${m.camera.loiters}: ${f.number(camera.loiters)}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </section>

      {period !== "today" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={m.camera.perHour} hint={`${m.camera.perHourHint} ${hourLine}`}>
            <Bars items={hourBars} height={150} labelEvery={3} />
          </Panel>
          <Panel
            title={m.camera.perWeekday}
            hint={week.enough ? (week.busiest !== null ? fmt(m.camera.busiestDay, { day: m.common.weekdays[week.busiest - 1] }) : m.camera.perWeekdayHint) : m.camera.perWeekdayTooShort}
          >
            <BarList
              items={week.days.map((w) => ({
                key: String(w.weekday),
                label: m.common.weekdaysShort[w.weekday - 1],
                value: w.average,
                display: f.number(oneDecimal(w.average)),
                strong: w.weekday === week.busiest,
              }))}
            />
          </Panel>
        </div>
      )}

      <Panel title={m.camera.longStays} hint={m.camera.longStaysHint}>
        {camera.long_list.length === 0 ? (
          <p className="text-[14px] text-muted">{m.camera.noLongStays}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-[14px]">
            {camera.long_list.map((stay) => (
              <li key={stay.started_at} className="py-2">
                {fmt(m.camera.longStay, {
                  date: f.date(stay.started_at),
                  from: f.time(stay.started_at),
                  to: f.time(stay.ended_at),
                  minutes: Math.round((new Date(stay.ended_at).getTime() - new Date(stay.started_at).getTime()) / 60_000),
                })}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
