import Link from "next/link";
import { after } from "next/server";
import { Cctv, TriangleAlert } from "lucide-react";
import { CameraWall } from "@/components/camera-wall";
import { FetchNow } from "@/components/fetch-now";
import { SyncLine } from "@/components/sync-line";
import { Change, Dot, Empty, PageHeader, PeriodLinks, Section, Stat } from "@/components/ui";
import { fmt } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { requireLogin } from "@/lib/auth";
import { DEMO, getCameras, getSalesReport, getSyncStates, getTerminals, getVisitorsReport } from "@/lib/data";
import { payterConfigured } from "@/lib/payter";
import { salesTotal } from "@/lib/sales";
import { runSync } from "@/lib/sync";
import { unifiConfigured } from "@/lib/unifi";
import { cameraCheck, parsePeriod, PERIODS, totalVisits, visitsVerdict } from "@/lib/visitors";

/** Reading UniFi and Payter after the page can take a few calls of a few seconds each. */
export const maxDuration = 60;

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireLogin();
  const { m, f } = await getI18n();
  const period = parsePeriod((await searchParams).period, "today");
  const days = PERIODS[period];
  const [cameras, terminals, sync] = await Promise.all([getCameras(), getTerminals(), getSyncStates()]);
  const shown = cameras.filter((c) => !c.hidden);
  const followed = terminals.filter((t) => t.followed);
  const [visitors, sales] = await Promise.all([getVisitorsReport(shown.map((c) => c.cameraId), days), getSalesReport(followed.map((t) => t.serial), days)]);
  // Whatever is due is read after the page, never before it.
  if (!DEMO) after(() => runSync());

  const total = visitors ? totalVisits(visitors) : null;
  const money = sales ? salesTotal(sales) : null;
  const compareLabel = m.common.compare[period];
  const hiddenCount = cameras.length - shown.length;

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
        <PeriodLinks hrefFor={(key) => (key === "today" ? "/" : `/?period=${key}`)} current={period} labels={m.common.periods} />

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="card px-5 py-5 sm:px-6">
            <p className="text-[14px] font-semibold text-muted">{m.overview.visitors}</p>
            {total ? (
              <>
                <p className="mt-1 text-[40px] font-bold leading-none tracking-[-0.03em]">{f.number(total.visits)}</p>
                <div className="mt-2">
                  <Change verdict={total.verdict} current={total.current} previous={total.previous} first={total.first} label={compareLabel} m={m} f={f} />
                </div>
                <p className="mt-3 text-[12.5px] text-muted">{m.overview.visitorsHint}</p>
              </>
            ) : (
              <p className="mt-2 text-[14px] text-muted">{unifiConfigured() || DEMO ? m.overview.noCamerasHint : m.overview.noKeyHint}</p>
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

        <Section
          title={m.overview.cameras}
          hint={[m.overview.camerasHint, hiddenCount > 0 ? fmt(m.overview.hiddenCount, { n: hiddenCount }) : null].filter(Boolean).join(" · ")}
        >
          {!unifiConfigured() && !DEMO ? (
            <Empty title={m.overview.noKey} hint={m.overview.noKeyHint} icon={<Cctv className="size-5" />} />
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
