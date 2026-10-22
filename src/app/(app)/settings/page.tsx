import { CircleCheck, CircleSlash, TriangleAlert } from "lucide-react";
import { AutoSaveCheckbox } from "@/components/auto-save-checkbox";
import { Dot, PageHeader, Panel } from "@/components/ui";
import { FetchNow } from "@/components/fetch-now";
import { fmt } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { requireLogin } from "@/lib/auth";
import { getCameras, getSyncStates, getTerminals } from "@/lib/data";
import { DEMO } from "@/lib/data";
import { payterConfigured } from "@/lib/payter";
import type { SyncState } from "@/lib/sync";
import { unifiConfigured } from "@/lib/unifi";
import { setLanguage } from "../actions";
import { renameTerminal, setCameraHidden, setCameraTerminals, setTerminalFollowed } from "./actions";

export async function generateMetadata() {
  const { m } = await getI18n();
  return { title: m.settings.title };
}

export default async function SettingsPage() {
  await requireLogin();
  const { m, f, locale } = await getI18n();
  const [cameras, terminals, sync] = await Promise.all([getCameras(), getTerminals(), getSyncStates()]);
  const followed = terminals.filter((t) => t.followed);
  const accounts = new Set(terminals.map((t) => t.account)).size;

  const status = (configured: boolean, states: SyncState[]) => {
    if (!configured && !DEMO) return { ok: false, text: m.settings.notConfigured };
    const failed = states.find((s) => s.lastError)?.lastError;
    if (failed) return { ok: false, text: failed === "busy" ? m.settings.busy : fmt(m.settings.failed, { error: failed.slice(0, 120) }) };
    const run = states.map((s) => s.lastRun).filter((r): r is string => Boolean(r)).sort()[0];
    return { ok: Boolean(run), text: run ? fmt(m.settings.readAt, { time: f.dateTime(run) }) : m.settings.notRead };
  };
  const unifi = status(unifiConfigured(), sync.filter((s) => s.source === "consoles" || s.source.startsWith("protect:")));
  const payter = status(payterConfigured(), sync.filter((s) => s.source.startsWith("payter")));

  return (
    <>
      <PageHeader title={m.settings.title} subtitle={m.settings.subtitle} actions={<FetchNow />} />
      <div className="flex flex-col gap-6">
        <Panel title={m.settings.connections} hint={m.settings.auto}>
          <ul className="flex flex-col divide-y divide-line">
            {[
              { name: m.settings.unifi, ...unifi },
              { name: m.settings.payter, ...payter },
            ].map((row) => (
              <li key={row.name} className="flex items-start gap-3 py-3">
                {row.ok ? (
                  <CircleCheck className="mt-0.5 size-5 shrink-0 text-up" aria-hidden="true" />
                ) : row.text === m.settings.notConfigured ? (
                  <CircleSlash className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
                ) : (
                  <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden="true" />
                )}
                <div>
                  <p className="text-[15px] font-semibold">{row.name}</p>
                  <p className="text-[13.5px] text-muted">{row.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={m.settings.cameras} hint={m.settings.camerasHint}>
          {cameras.length === 0 ? (
            <p className="text-[14px] text-muted">{m.overview.noCamerasHint}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {cameras.map((camera) => (
                <li key={camera.cameraId} className="flex flex-col gap-3 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`text-[15px] font-semibold ${camera.hidden ? "text-muted" : ""}`}>
                        {camera.name}
                        {camera.hidden ? ` · ${m.settings.hidden}` : ""}
                      </p>
                      <p className="text-[13px] text-muted">{[camera.model, camera.consoleName].filter(Boolean).join(" · ")}</p>
                    </div>
                    <form action={setCameraHidden}>
                      <input type="hidden" name="camera" value={camera.cameraId} />
                      <input type="hidden" name="hidden" value={camera.hidden ? "false" : "true"} />
                      <button type="submit" className="btn btn-secondary btn-small">
                        {camera.hidden ? m.settings.show : m.settings.hide}
                      </button>
                    </form>
                  </div>
                  {!camera.hidden && (
                    <form action={setCameraTerminals} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <input type="hidden" name="camera" value={camera.cameraId} />
                      <span className="text-[13.5px] font-semibold text-muted">{m.settings.looksAt}</span>
                      {followed.length === 0 ? (
                        <span className="text-[13.5px] text-muted">{m.settings.noTerminalsYet}</span>
                      ) : (
                        <>
                          {followed.map((t) => (
                            <label key={t.serial} className="inline-flex items-center gap-2 text-[14px]">
                              <AutoSaveCheckbox name="serial" value={t.serial} defaultChecked={camera.terminals.includes(t.serial)} className="size-4 accent-[var(--accent)]" />
                              {t.label}
                            </label>
                          ))}
                          <noscript>
                            <button type="submit" className="btn btn-secondary btn-small">
                              {m.common.save}
                            </button>
                          </noscript>
                        </>
                      )}
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={m.settings.terminals} hint={m.settings.terminalsHint}>
          {terminals.length === 0 ? (
            <p className="text-[14px] text-muted">{payterConfigured() || DEMO ? m.settings.noTerminals : m.sales.notSetUpHint}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {terminals.map((t) => (
                <li key={t.serial} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">{t.label}</p>
                    <p className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
                      <span>{[t.serial, t.model, t.site, accounts > 1 ? fmt(m.settings.account, { n: t.account }) : null].filter(Boolean).join(" · ")}</span>
                      <Dot on={t.online} label={t.online ? m.common.online : m.common.offline} />
                    </p>
                  </div>
                  {t.followed && (
                    <form action={renameTerminal} className="flex gap-2">
                      <input type="hidden" name="serial" value={t.serial} />
                      <input name="name" defaultValue={t.name ?? ""} placeholder={m.settings.namePlaceholder} aria-label={m.settings.name} maxLength={60} className="field h-9 w-44 text-[14px]" />
                      <button type="submit" className="btn btn-ghost btn-small">
                        {m.common.save}
                      </button>
                    </form>
                  )}
                  <form action={setTerminalFollowed}>
                    <input type="hidden" name="serial" value={t.serial} />
                    <input type="hidden" name="followed" value={t.followed ? "false" : "true"} />
                    <button type="submit" className={`btn btn-small ${t.followed ? "btn-secondary" : "btn-primary"}`}>
                      {t.followed ? m.settings.unfollow : m.settings.follow}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={m.settings.language}>
          <form action={setLanguage} className="flex gap-1.5">
            {(
              [
                ["nl", "Nederlands"],
                ["en", "English"],
              ] as const
            ).map(([code, label]) => (
              <button key={code} type="submit" name="locale" value={code} className="pill" aria-pressed={locale === code}>
                {label}
              </button>
            ))}
          </form>
        </Panel>

        <Panel title={m.settings.privacy}>
          <div className="flex flex-col gap-2 text-[14px] leading-relaxed text-muted">
            {[m.settings.privacy1, m.settings.privacy2, m.settings.privacy3, m.settings.privacy4].map((line) => (
              <p key={line} className="max-w-[70ch]">
                {line}
              </p>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
