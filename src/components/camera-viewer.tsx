"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Maximize2, Minimize2, Radio, RefreshCw, Square, X } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { LIVE_EVERY_MS, NEXT_HEADER } from "@/lib/camera-pace";

/** Live: a new photo every few seconds, never longer than a minute. */
const LIVE_FOR_MS = 60_000;

/** What one request for a photo gave: a photo and the wait before the next, a wait, or nothing. */
type Taken = { kind: "photo"; every: number } | { kind: "busy"; wait: number } | { kind: "error" };

/**
 * A photo of this moment from one camera, only on a tap, so the camera is asked only when someone looks; the
 * photo lives in this page and is gone when it closes. Live repeats it every few seconds for a minute, as slow
 * as the server says when several people watch, and stops sooner when the page is left or two photos in a row
 * fail. Full screen: the photo as big as the screen, Live going on in it.
 */
export function CameraViewer({ cameraId, name, compact = false }: { cameraId: string; name: string; compact?: boolean }) {
  const { m, f } = useI18n();
  const [shot, setShot] = useState<{ url: string; at: Date } | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "busy">("idle");
  const [busyFor, setBusyFor] = useState(0);
  const [live, setLive] = useState(false);
  const [full, setFull] = useState(false);
  const overlay = useRef<HTMLDivElement>(null);
  const url = useRef<string | null>(null);
  const liveRun = useRef(0);
  const timer = useRef<number | null>(null);

  function stopLive() {
    liveRun.current += 1;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setLive(false);
  }

  function leaveFull() {
    setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }

  function close() {
    leaveFull();
    stopLive();
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setShot(null);
    setState("idle");
  }

  // Where the browser allows it, really full screen; an iPhone only does that for video, so there the black
  // layer fills the window. Leaving the browser's full screen (a swipe, Esc) leaves ours too.
  useEffect(() => {
    if (!full) return;
    const element = overlay.current;
    if (element?.requestFullscreen && !document.fullscreenElement) void element.requestFullscreen().catch(() => undefined);
    const onChange = () => !document.fullscreenElement && setFull(false);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setFull(false);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = scroll;
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("keydown", onKey);
    };
  }, [full]);

  // Leaving the page or the app stops the photos; the blob goes with the page.
  useEffect(() => {
    const onHide = () => document.hidden && stopLive();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      stopLive();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);

  async function take(): Promise<Taken> {
    setState("loading");
    try {
      const res = await fetch(`/api/camera/${encodeURIComponent(cameraId)}`, { cache: "no-store" });
      if (res.status === 429) {
        const seconds = Math.max(1, Number(res.headers.get("Retry-After")) || 10);
        setBusyFor(seconds);
        setState("busy");
        return { kind: "busy", wait: seconds * 1000 };
      }
      if (!res.ok) throw new Error(String(res.status));
      const next = URL.createObjectURL(await res.blob());
      // Decoded before it is shown, so Live never flashes an empty frame between two photos.
      const image = new Image();
      image.src = next;
      await image.decode().catch(() => undefined);
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = next;
      setShot({ url: next, at: new Date() });
      setState("idle");
      return { kind: "photo", every: Math.max(LIVE_EVERY_MS, Number(res.headers.get(NEXT_HEADER)) || 0) };
    } catch {
      return { kind: "error" };
    }
  }

  async function takeOne() {
    if ((await take()).kind === "error") setState("error");
  }

  function startLive() {
    const run = ++liveRun.current;
    const until = Date.now() + LIVE_FOR_MS;
    setLive(true);
    let missed = false;
    const tick = async () => {
      if (liveRun.current !== run) return;
      if (Date.now() > until || document.hidden) return stopLive();
      const started = Date.now();
      const taken = await take();
      if (liveRun.current !== run) return;
      if (taken.kind === "error") {
        // One failed photo is tried once more; a camera that keeps failing is not asked again and again.
        if (missed) {
          setState("error");
          return stopLive();
        }
        missed = true;
      } else {
        missed = false;
      }
      const wait = taken.kind === "photo" ? taken.every - (Date.now() - started) : taken.kind === "busy" ? taken.wait : 1_000;
      timer.current = window.setTimeout(tick, Math.max(500, wait));
    };
    void tick();
  }

  const loading = state === "loading";
  const alt = fmt(m.camera.alt, { name });
  const status = live
    ? shot
      ? fmt(m.camera.liveAt, { time: f.timeSeconds(shot.at) })
      : m.camera.liveHint
    : shot
      ? fmt(m.camera.takenAt, { time: f.time(shot.at) })
      : m.camera.hint;

  return (
    <div className={compact ? "" : "card px-5 py-5 sm:px-6"}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {!compact && (
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-[16px] font-semibold">
              {m.camera.photo}
              {live && <span className="size-2 animate-pulse rounded-full bg-live" aria-hidden="true" />}
            </h2>
            <p className="mt-0.5 text-[13px] text-muted" aria-live="polite">
              {status}
            </p>
          </div>
        )}
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {live ? (
            <button type="button" onClick={close} className="btn btn-primary flex-1 sm:flex-none">
              <Square aria-hidden="true" />
              {m.camera.liveStop}
            </button>
          ) : (
            <>
              <button type="button" onClick={() => void takeOne()} disabled={loading} className={`btn ${shot ? "btn-secondary" : "btn-primary"} flex-1 sm:flex-none`}>
                {shot ? <RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden="true" /> : <Camera aria-hidden="true" />}
                {loading ? m.camera.loading : shot ? m.camera.again : m.camera.show}
              </button>
              <button type="button" onClick={startLive} disabled={loading} className="btn btn-secondary flex-1 sm:flex-none">
                <Radio aria-hidden="true" />
                {m.camera.live}
              </button>
              {(shot || state === "error" || state === "busy") && (
                <button type="button" onClick={close} className="btn btn-ghost flex-1 sm:flex-none">
                  <X aria-hidden="true" />
                  {m.common.close}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {compact && (shot || live) && (
        <p className="mt-2 text-[12.5px] text-muted" aria-live="polite">
          {status}
        </p>
      )}
      {state === "error" && (
        <p role="alert" className="mt-3 text-[14px] font-medium text-down">
          {m.camera.error}
        </p>
      )}
      {state === "busy" && (
        <p role="status" className="mt-3 text-[14px] text-muted">
          {fmt(m.camera.busy, { seconds: busyFor })}
        </p>
      )}
      {shot && !full && (
        <div className="relative mt-4">
          {/* A blob from this page, not a file Next could optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shot.url}
            alt={alt}
            onClick={() => setFull(true)}
            className={`w-full cursor-zoom-in rounded-xl bg-surface object-contain transition-opacity ${loading && !live ? "opacity-60" : ""}`}
          />
          <button
            type="button"
            onClick={() => setFull(true)}
            aria-label={m.camera.fullscreen}
            title={m.camera.fullscreen}
            className="absolute right-2 top-2 grid size-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70"
          >
            <Maximize2 className="size-[18px]" />
          </button>
        </div>
      )}
      {/* In the body, so nothing on the page (a transform, a sticky bar) can hold the layer to a smaller box. */}
      {shot &&
        full &&
        createPortal(
          <div ref={overlay} role="dialog" aria-modal="true" aria-label={alt} className="fixed inset-0 z-[100] flex flex-col bg-black text-white">
            <div className="flex items-center gap-3 px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
              <p className="flex min-w-0 flex-1 items-center gap-2 text-[14px] font-semibold">
                {live && <span className="size-2 shrink-0 animate-pulse rounded-full bg-live" aria-hidden="true" />}
                <span className="truncate">
                  {name} · {status}
                </span>
              </p>
              {live && (
                <button type="button" onClick={close} className="h-10 rounded-full bg-white/15 px-4 text-[14px] font-semibold hover:bg-white/25">
                  {m.camera.liveStop}
                </button>
              )}
              <button
                type="button"
                onClick={leaveFull}
                aria-label={m.camera.fullscreenClose}
                title={m.camera.fullscreenClose}
                className="grid size-10 place-items-center rounded-full bg-white/15 hover:bg-white/25"
              >
                <Minimize2 className="size-[18px]" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center pb-[env(safe-area-inset-bottom)]" onClick={leaveFull}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot.url} alt={alt} className="max-h-full max-w-full object-contain" />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
