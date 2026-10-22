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
import { DEMO, getCameras, getEntrancesReport, getSalesReport, getSyncStates, getTerminals, getVisitorsReport } from "@/lib/data";
import { entriesVerdict, entryMethod, lineSinceInPeriod } from "@/lib/entrances";
import { payterConfigured } from "@/lib/payter";
import { salesTotal } from "@/lib/sales";
import { runSync } from "@/lib/sync";
import { unifiConfigured } from "@/lib/unifi";
import { cameraCheck, parsePeriod, PERIODS, visitsVerdict } from "@/lib/visitors";

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
  const entranceCameras = shown.filter((c) => c.entrance);
  const [visitors, sales, entries] = await Promise.all([
    getVisitorsReport(shown.map((c) => c.cameraId), days),
    getSalesReport(followed.map((t) => t.serial), days),
    getEntrancesReport(entranceCameras.map((c) => c.cameraId), days),
  ]);
  // Whatever is due is read after the page, never before it.
  if (!DEMO) after(() => runSync());

  const method = entries ? entryMethod(entries) : null;
  const lineSince = entries ? lineSinceInPeriod(entries) : null;
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
                <p className="mt-3 text-[12.5px] leading-snug text-muted">
                  {lineSince
                    ? fmt(m.overview.entriesLineSince, { cameras: doorNames, date: f.dayMonth(lineSince) })
                    : fmt(method === "line" ? m.overview.entriesLine : m.overview.entriesZone, { cameras: doorNames })}
                </p>
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
