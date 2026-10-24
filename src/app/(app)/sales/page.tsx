import Link from "next/link";
import { after } from "next/server";
import { Receipt } from "lucide-react";
import { FetchNow } from "@/components/fetch-now";
import { SalesDrops } from "@/components/sales-drops";
import { SyncLine } from "@/components/sync-line";
import { BarList, Bars, Change, Empty, PageHeader, Panel, PeriodLinks, Stat } from "@/components/ui";
import { fmt } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { requireLogin } from "@/lib/auth";
import { salesDrops } from "@/lib/alerts";
import { DEMO, getCameras, getMachinePace, getSalesReport, getSyncStates, getTerminals } from "@/lib/data";
import { isSalesSource, payterConfigured } from "@/lib/payter";
import { salesDays, salesHours, salesTotal, salesVerdict, salesWeekdays, stillReadingUntil, type TerminalSales } from "@/lib/sales";
import { MIN_WEEKS, weekdayStats, busiestWeekday } from "@/lib/stats";
import { runSync } from "@/lib/sync";
import { DAYS_BACK, parsePeriod, PERIODS, type PeriodKey } from "@/lib/visitors";

export const maxDuration = 60;

export async function generateMetadata() {
  const { m } = await getI18n();
  return { title: m.sales.title };
}

const clock = (hour: number) => `${String(hour % 24).padStart(2, "0")}:00`;
const oneDecimal = (value: number) => Math.round(value * 10) / 10;

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ period?: string; terminal?: string }> }) {
  await requireLogin();
  const { m, f } = await getI18n();
  const query = await searchParams;
  const period = parsePeriod(query.period, "month");
  const [terminals, cameras, sync] = await Promise.all([getTerminals(), getCameras(), getSyncStates()]);
  const followed = terminals.filter((t) => t.followed);
  const chosen = followed.find((t) => t.serial === query.terminal) ?? null;
  const [report, pace] = await Promise.all([
    getSalesReport(chosen ? [chosen.serial] : followed.map((t) => t.serial), PERIODS[period], DAYS_BACK[period]),
    getMachinePace(followed.map((t) => t.serial)),
  ]);
  if (!DEMO) after(() => runSync());

  const href = (p: PeriodKey, terminal: string | null) => {
    const params = new URLSearchParams();
    if (p !== "month") params.set("period", p);
    if (terminal) params.set("terminal", terminal);
    const text = params.toString();
    return text ? `/sales?${text}` : "/sales";
  };

  // The account furthest behind in reading its history decides.
  const catchingUp =
    sync
      .filter((s) => isSalesSource(s.source))
      .map((s) => stillReadingUntil(s.watermark))
      .filter((until): until is number => until !== null)
      .sort((a, b) => a - b)[0] ?? null;

  if (!payterConfigured() && !DEMO) {
    return (
      <>
        <PageHeader title={m.sales.title} subtitle={m.sales.subtitle} />
        <Empty title={m.sales.notSetUp} hint={m.sales.notSetUpHint} icon={<Receipt className="size-5" />} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={m.sales.title}
        subtitle={m.sales.subtitle}
        actions={
          <>
            <SyncLine states={sync} m={m} f={f} />
            <FetchNow />
          </>
        }
      />
      {followed.length === 0 || !report ? (
        <Empty title={m.sales.noTerminals} hint={m.sales.noTerminalsHint} icon={<Receipt className="size-5" />} />
      ) : (
        <div className="flex flex-col gap-6">
          <SalesDrops drops={salesDrops(pace)} names={new Map(terminals.map((t) => [t.serial, t.label]))} m={m} f={f} />
          <PeriodLinks hrefFor={(key) => href(key, chosen?.serial ?? null)} current={period} labels={m.common.periods} />
          {followed.length > 1 && (
            <nav className="flex flex-wrap gap-1.5" aria-label={m.settings.terminals}>
              <Link href={href(period, null)} className="pill" aria-current={!chosen ? "page" : undefined} scroll={false}>
                {m.sales.all}
              </Link>
              {followed.map((t) => (
                <Link key={t.serial} href={href(period, t.serial)} className="pill" aria-current={chosen?.serial === t.serial ? "page" : undefined} scroll={false}>
                  {t.label}
                </Link>
              ))}
            </nav>
          )}
          {catchingUp && <p className="text-[13.5px] text-warn">{fmt(m.sales.catchingUp, { date: f.dayMonth(catchingUp) })}</p>}
          <SalesFigures
            report={report}
            single={chosen ? report.terminals[0] : null}
            period={period}
            labels={new Map(followed.map((t) => [t.serial, t.label]))}
            cameraNames={chosen ? cameras.filter((c) => c.terminals.includes(chosen.serial)).map((c) => c.name) : []}
            m={m}
            f={f}
          />
        </div>
      )}
    </>
  );
}

function SalesFigures({
  report,
  single,
  period,
  labels,
  cameraNames,
  m,
  f,
}: {
  report: NonNullable<Awaited<ReturnType<typeof getSalesReport>>>;
  single: TerminalSales | null;
  period: PeriodKey;
  labels: Map<string, string>;
  cameraNames: string[];
  m: Awaited<ReturnType<typeof getI18n>>["m"];
  f: Awaited<ReturnType<typeof getI18n>>["f"];
}) {
  const total = salesTotal(report);
  const t = single ?? null;
  const units = t ? t.units : total.units;
  const revenue = t ? Number(t.revenue) : total.revenue;
  const verdict = t ? salesVerdict(t, report) : total.verdict;
  const days = salesDays(t ?? total, report);
  const hours = salesHours(t ?? total, report);
  const week = t
    ? salesWeekdays(t, report)
    : (() => {
        const stats = weekdayStats(report, total.by_weekday.map((w) => ({ weekday: w.weekday, count: w.units })));
        return { days: stats, busiest: busiestWeekday(stats), enough: stats.every((d) => d.days >= MIN_WEEKS) };
      })();
  const hourLine =
    [
      hours.busiest !== null ? fmt(m.camera.busiestHour, { from: clock(hours.busiest), to: clock(hours.busiest + 1) }) : null,
      hours.quietest !== null ? fmt(m.camera.quietestHour, { from: clock(hours.quietest), to: clock(hours.quietest + 1) }) : null,
    ]
      .filter(Boolean)
      .join(" ") || m.camera.noStandout;
  const declined = t ? t.declined : total.declined;
  const lastSale = t ? t.last_sale : total.last_sale;

  return (
    <>
      <section className="card px-5 py-5 sm:px-6 sm:py-6">
        <p className="text-[14px] font-semibold text-muted">{m.sales.revenue}</p>
        <p className="mt-1 text-[40px] font-bold leading-none tracking-[-0.03em]">{f.euro(revenue)}</p>
        <div className="mt-2">
          <Change
            verdict={verdict}
            current={t ? t.units : total.compared.units}
            previous={t ? t.prev_units : total.compared.previous}
            first={t ? t.first_sale : (report.terminals.map((x) => x.first_sale).filter((x): x is string => Boolean(x)).sort()[0] ?? null)}
            label={m.common.compare[period]}
            m={m}
            f={f}
          />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Stat label={m.sales.items} value={f.number(units)} />
          <Stat label={m.sales.perItem} value={units > 0 ? f.euro(revenue / units) : "–"} />
          <Stat label={m.sales.perDayRevenue} value={f.euro(revenue / Math.max(days.length, 1))} />
          <Stat label={m.sales.lastSaleLabel} value={lastSale ? f.dateTime(lastSale) : "–"} />
        </div>
        <div className="mt-7">
          {period === "today" ? (
            <Bars
              items={hours.perDay.map((h) => ({ key: String(h.hour), label: String(h.hour).padStart(2, "0"), value: h.value, display: f.number(h.value), strong: h.hour === hours.busiest }))}
              labelEvery={3}
            />
          ) : (
            <Bars items={days.map((d) => ({ key: d.day, label: f.dayMonth(`${d.day}T12:00:00Z`), value: Number(d.revenue), display: `${f.euro(Number(d.revenue))} · ${f.number(d.units)}` }))} />
          )}
        </div>
        <p className="mt-4 text-[13.5px] text-muted">
          {[declined > 0 ? fmt(m.sales.declined, { n: f.number(declined) }) : null, cameraNames.length ? fmt(m.sales.camera, { name: cameraNames.join(", ") }) : null].filter(Boolean).join(" · ")}
        </p>
      </section>

      {period !== "today" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={m.sales.perHour} hint={`${m.sales.perHourHint} ${hourLine}`}>
            <Bars
              items={hours.perDay.map((h) => ({
                key: String(h.hour),
                label: String(h.hour).padStart(2, "0"),
                value: h.value,
                display: fmt(m.common.perDayValue, { n: f.number(oneDecimal(h.value)) }),
                strong: h.hour === hours.busiest,
              }))}
              height={150}
              labelEvery={3}
            />
          </Panel>
          <Panel
            title={m.sales.perWeekday}
            hint={week.enough ? (week.busiest !== null ? fmt(m.sales.busiestDay, { day: m.common.weekdays[week.busiest - 1] }) : m.sales.perWeekdayHint) : m.camera.perWeekdayTooShort}
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

      {t ? (
        <Panel title={m.sales.bestSellers} hint={m.sales.bestSellersHint}>
          {t.items.length === 0 ? (
            <p className="text-[14px] text-muted">–</p>
          ) : (
            <BarList
              items={t.items.slice(0, 12).map((item) => ({
                key: item.item_ref,
                label: item.item_ref === "?" ? m.sales.noSelection : fmt(m.sales.selection, { ref: item.item_ref }),
                value: item.units,
                display: `${f.number(item.units)} · ${f.euro(Number(item.revenue))}`,
              }))}
            />
          )}
        </Panel>
      ) : (
        <Panel title={m.sales.all}>
          <BarList
            items={[...report.terminals]
              .sort((a, b) => Number(b.revenue) - Number(a.revenue))
              .map((x) => ({ key: x.serial, label: labels.get(x.serial) ?? x.serial, value: Number(x.revenue), display: `${f.euro(Number(x.revenue))} · ${f.number(x.units)}` }))}
          />
        </Panel>
      )}
    </>
  );
}
