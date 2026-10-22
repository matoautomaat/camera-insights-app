import { cache } from "react";
import { db, TIME_ZONE } from "@/lib/db";
import { DEMO } from "@/lib/demo";
import { terminalOnline } from "@/lib/payter";
import type { SalesReport } from "@/lib/sales";
import { sampleCameras, sampleSales, sampleSyncStates, sampleTerminals, sampleVisitors } from "@/lib/sample";
import { readSyncStates, type SyncState } from "@/lib/sync";
import type { VisitorsReport } from "@/lib/visitors";

// Everything the pages read. Only the server calls it, and only after requireLogin().
// With CI_DEMO=1 on a developer's own machine it gives made-up figures instead, so the screens can be tried
// without UniFi, Payter or a database; never in production.

export { DEMO };

export type CameraInfo = {
  consoleId: string;
  consoleName: string;
  cameraId: string;
  name: string;
  model: string | null;
  online: boolean;
  detects: string[];
  fullHd: boolean | null;
  hidden: boolean;
  /** The Payter terminals this camera looks at (followed or not). */
  terminals: string[];
};

type CameraRow = {
  console_id: string;
  camera_id: string;
  name: string;
  model: string | null;
  online: boolean;
  detects: string[] | null;
  full_hd: boolean | null;
  hidden: boolean;
};

export const getCameras = cache(async (): Promise<CameraInfo[]> => {
  if (DEMO) return sampleCameras();
  const [cameras, consoles, links] = await Promise.all([
    db().from("ci_cameras").select("console_id, camera_id, name, model, online, detects, full_hd, hidden"),
    db().from("ci_consoles").select("console_id, name"),
    db().from("ci_camera_terminals").select("camera_id, serial"),
  ]);
  if (cameras.error) throw new Error(cameras.error.message);
  const consoleName = new Map((consoles.data ?? []).map((c) => [c.console_id as string, (c.name as string | null) ?? "UniFi"]));
  return ((cameras.data ?? []) as CameraRow[])
    .map((c) => ({
      consoleId: c.console_id,
      consoleName: consoleName.get(c.console_id) ?? "UniFi",
      cameraId: c.camera_id,
      name: c.name,
      model: c.model,
      online: c.online,
      detects: c.detects ?? [],
      fullHd: c.full_hd,
      hidden: c.hidden,
      terminals: (links.data ?? []).filter((l) => l.camera_id === c.camera_id).map((l) => l.serial as string),
    }))
    .sort((a, b) => Number(a.hidden) - Number(b.hidden) || a.name.localeCompare(b.name));
});

export async function getCamera(cameraId: string): Promise<CameraInfo | null> {
  return (await getCameras()).find((c) => c.cameraId === cameraId) ?? null;
}

/** A camera that refused a full HD photo: asked for the usual one straight away from now on. */
export async function rememberNoFullHd(consoleId: string, cameraId: string): Promise<void> {
  if (DEMO) return;
  const { error } = await db().from("ci_cameras").update({ full_hd: false }).eq("console_id", consoleId).eq("camera_id", cameraId);
  if (error) console.error("full_hd not saved", { error: error.message });
}

export async function getVisitorsReport(cameraIds: string[], days: number): Promise<VisitorsReport | null> {
  if (!cameraIds.length) return null;
  if (DEMO) return sampleVisitors(cameraIds, days);
  const { data, error } = await db().rpc("ci_visitors_report", { camera_ids: cameraIds, period_days: days, tz: TIME_ZONE });
  if (error) throw new Error(error.message);
  return data as VisitorsReport;
}

export type TerminalInfo = {
  serial: string;
  /** The name given here, or else Payter's site reference, or else the serial number. */
  label: string;
  name: string | null;
  model: string | null;
  site: string | null;
  online: boolean;
  followed: boolean;
  /** Which Payter login it was read from: 1 = PAYTER_*, 2 = PAYTER_2_*, … */
  account: number;
};

type TerminalRow = {
  serial: string;
  name: string | null;
  model: string | null;
  site: string | null;
  last_connect: string | null;
  last_disconnect: string | null;
  followed: boolean;
  account: number | null;
};

export const getTerminals = cache(async (): Promise<TerminalInfo[]> => {
  if (DEMO) return sampleTerminals();
  const { data, error } = await db().from("ci_terminals").select("serial, name, model, site, last_connect, last_disconnect, followed, account");
  if (error) throw new Error(error.message);
  return ((data ?? []) as TerminalRow[])
    .map((t) => ({
      serial: t.serial,
      label: t.name?.trim() || t.site?.trim() || t.serial,
      name: t.name,
      model: t.model,
      site: t.site,
      online: terminalOnline({ lastConnect: t.last_connect, lastDisconnect: t.last_disconnect }),
      followed: t.followed,
      account: t.account ?? 1,
    }))
    .sort((a, b) => Number(b.followed) - Number(a.followed) || a.label.localeCompare(b.label));
});

export async function getSalesReport(serials: string[], days: number): Promise<SalesReport | null> {
  if (!serials.length) return null;
  if (DEMO) return sampleSales(serials, days);
  const { data, error } = await db().rpc("ci_sales_report", { serials, period_days: days, tz: TIME_ZONE });
  if (error) throw new Error(error.message);
  return data as SalesReport;
}

export async function getSyncStates(): Promise<SyncState[]> {
  return DEMO ? sampleSyncStates() : readSyncStates();
}
