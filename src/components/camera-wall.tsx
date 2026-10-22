"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { fmt } from "@/i18n/format";

type Tile = { state: "loading" | "photo" | "error"; url?: string; at?: Date };

/**
 * Every camera at once, one photo each, only on a tap (each photo is a call on the console's minute). Two at a
 * time, so a console with many cameras is not asked all at once. A tile opens that camera's own page.
 */
export function CameraWall({ cameras }: { cameras: { id: string; name: string }[] }) {
  const { m, f } = useI18n();
  const [tiles, setTiles] = useState<Record<string, Tile>>({});
  const [busy, setBusy] = useState(false);
  const urls = useRef<string[]>([]);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function one(id: string) {
    setTiles((t) => ({ ...t, [id]: { ...t[id], state: "loading" } }));
    try {
      const res = await fetch(`/api/camera/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      urls.current.push(url);
      setTiles((t) => {
        if (t[id]?.url) URL.revokeObjectURL(t[id].url!);
        return { ...t, [id]: { state: "photo", url, at: new Date() } };
      });
    } catch {
      setTiles((t) => ({ ...t, [id]: { ...t[id], state: "error" } }));
    }
  }

  async function all() {
    setBusy(true);
    const queue = [...cameras.map((c) => c.id)];
    await Promise.all(
      [0, 1].map(async () => {
        while (queue.length) await one(queue.shift()!);
      }),
    );
    setBusy(false);
  }

  const any = Object.keys(tiles).length > 0;
  return (
    <div className="card px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold">{m.overview.wall}</h2>
          <p className="text-[13px] text-muted">{m.overview.wallHint}</p>
        </div>
        <button type="button" className={`btn ${any ? "btn-secondary" : "btn-primary"}`} onClick={() => void all()} disabled={busy}>
          {any ? <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden="true" /> : <Camera aria-hidden="true" />}
          {busy ? m.overview.wallLoading : any ? m.overview.wallAgain : m.overview.wallShow}
        </button>
      </div>
      {any && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cameras.map((camera) => {
            const tile = tiles[camera.id];
            return (
              <Link key={camera.id} href={`/cameras/${encodeURIComponent(camera.id)}`} className="group overflow-hidden rounded-xl bg-surface">
                <div className="relative aspect-video">
                  {tile?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={tile.url} alt={fmt(m.camera.alt, { name: camera.name })} className={`size-full object-cover ${tile.state === "loading" ? "opacity-60" : ""}`} />
                  ) : (
                    <div className={`grid size-full place-items-center text-[13px] text-muted ${tile?.state === "loading" ? "skeleton" : ""}`}>
                      {tile?.state === "error" ? m.overview.wallFailed : ""}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2 text-[13.5px]">
                  <span className="truncate font-semibold group-hover:underline">{camera.name}</span>
                  <span className="shrink-0 text-muted">{tile?.at ? f.time(tile.at) : ""}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
