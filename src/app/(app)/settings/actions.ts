"use server";

import { revalidatePath } from "next/cache";
import { requireLogin } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEMO } from "@/lib/data";
import { salesSource } from "@/lib/payter";

// What Settings changes. Every action checks the login itself, and only names cameras and terminals that exist.

async function cameraExists(cameraId: string) {
  const { data } = await db().from("ci_cameras").select("camera_id").eq("camera_id", cameraId).limit(1);
  return Boolean(data?.length);
}

async function terminalExists(serial: string) {
  const { data } = await db().from("ci_terminals").select("serial").eq("serial", serial).limit(1);
  return Boolean(data?.length);
}

const text = (form: FormData, key: string, max = 200) => String(form.get(key) ?? "").trim().slice(0, max);

function done() {
  revalidatePath("/", "layout");
}

export async function setCameraHidden(form: FormData): Promise<void> {
  await requireLogin();
  if (DEMO) return;
  const cameraId = text(form, "camera");
  if (!(await cameraExists(cameraId))) return;
  await db().from("ci_cameras").update({ hidden: form.get("hidden") === "true" }).eq("camera_id", cameraId);
  done();
}

/** Whether a camera sees the entrance: the cameras that do count everyone coming in, once. */
export async function setCameraEntrance(form: FormData): Promise<void> {
  await requireLogin();
  if (DEMO) return;
  const cameraId = text(form, "camera");
  if (!(await cameraExists(cameraId))) return;
  await db().from("ci_cameras").update({ entrance: form.get("entrance") === "true" }).eq("camera_id", cameraId);
  done();
}

/** The Payter terminals a camera looks at: exactly the ones ticked. */
export async function setCameraTerminals(form: FormData): Promise<void> {
  await requireLogin();
  if (DEMO) return;
  const cameraId = text(form, "camera");
  if (!(await cameraExists(cameraId))) return;
  const wanted = [...new Set(form.getAll("serial").map((v) => String(v).trim()).filter(Boolean))].slice(0, 20);
  const { data } = wanted.length ? await db().from("ci_terminals").select("serial").in("serial", wanted) : { data: [] };
  const serials = (data ?? []).map((row) => row.serial as string);
  await db().from("ci_camera_terminals").delete().eq("camera_id", cameraId);
  if (serials.length) await db().from("ci_camera_terminals").insert(serials.map((serial) => ({ camera_id: cameraId, serial })));
  done();
}

/**
 * Follow a terminal or stop. Following one reads Payter's history again from the start (only the followed
 * terminals' sales are stored, so its older sales were never kept); stopping keeps what was stored.
 */
export async function setTerminalFollowed(form: FormData): Promise<void> {
  await requireLogin();
  if (DEMO) return;
  const serial = text(form, "serial");
  if (!(await terminalExists(serial))) return;
  const followed = form.get("followed") === "true";
  const { data } = await db().from("ci_terminals").update({ followed }).eq("serial", serial).select("account").maybeSingle();
  // Its own account's history is read again from the start; the other accounts carry on.
  const account = Number(data?.account) || 1;
  if (followed) await db().from("ci_sync").upsert({ source: salesSource({ id: account }), watermark: 0, synced_until: null, last_run: null }, { onConflict: "source" });
  done();
}

export async function renameTerminal(form: FormData): Promise<void> {
  await requireLogin();
  if (DEMO) return;
  const serial = text(form, "serial");
  if (!(await terminalExists(serial))) return;
  const name = text(form, "name", 60);
  await db().from("ci_terminals").update({ name: name || null }).eq("serial", serial);
  done();
}
