// UniFi Protect through Ubiquiti's own cloud (api.ui.com), so nothing has to be opened at the shop. One Site
// Manager key (UNIFI_API_KEY, from unifi.ui.com → Settings → API Keys) sees every console and camera on the
// account and can steer them, so it never leaves the server. Photos go straight from the camera to whoever is
// logged in; nothing is stored.

import { CONSOLE_BUDGET, msToNextMinute, retryAfterMs, sharing } from "@/lib/camera-pace";
import { db } from "@/lib/db";

const API = "https://api.ui.com";
/** The connector itself gives up after 25 seconds. */
const TIMEOUT_MS = 20_000;

export function unifiConfigured(): boolean {
  return Boolean(process.env.UNIFI_API_KEY?.trim());
}

async function call(path: string, accept = "application/json", timeout = TIMEOUT_MS): Promise<Response> {
  const key = process.env.UNIFI_API_KEY?.trim();
  if (!key) throw new Error("UNIFI_API_KEY is not set");
  return fetch(`${API}${path}`, {
    headers: { "X-API-Key": key, Accept: accept },
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
}

/** Protect's own API on one console, through the cloud connector. */
const protect = (consoleId: string, path: string) =>
  `/v1/connector/consoles/${encodeURIComponent(consoleId)}/protect/integration/v1${path}`;

/** Consoles UniFi told to wait (429), and until when. Kept for as long as this server runs. */
const WAIT_UNTIL = new Map<string, number>();

/** No photo now: UniFi, or this app's share of the console's minute, says wait this long. */
export class CameraBusyError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("UniFi is busy");
  }
}

/**
 * One call against this console's minute, counted in the database (unifi_call_take), the same count MATO Info
 * keeps, so together they stay under UniFi's 100. Gives the calls taken this minute, this one included; over
 * CONSOLE_BUDGET it is a CameraBusyError. When the database cannot count, the call goes ahead: UniFi's own
 * limit still stands behind it.
 */
async function takeCall(consoleId: string): Promise<number> {
  const waitUntil = WAIT_UNTIL.get(consoleId) ?? 0;
  if (waitUntil > Date.now()) throw new CameraBusyError(waitUntil - Date.now());
  let used: unknown = null;
  try {
    const { data, error } = await db().rpc("unifi_call_take", { p_console: consoleId, p_limit: CONSOLE_BUDGET });
    if (error) throw new Error(error.message);
    used = data;
  } catch (error) {
    console.error("UniFi calls not counted", { error: String(error) });
  }
  if (typeof used !== "number") return 0;
  if (used < 0) throw new CameraBusyError(msToNextMinute());
  return used;
}

/** UniFi said "too many requests" (429): the whole console waits as long as it asks. */
function throwIfAskedToWait(consoleId: string, res: Response) {
  if (res.status !== 429) return;
  const wait = retryAfterMs(res.headers.get("retry-after"));
  WAIT_UNTIL.set(consoleId, Date.now() + wait);
  console.error("UniFi asked to wait", { wait });
  throw new CameraBusyError(wait);
}

export type UnifiConsole = { id: string; name: string };

type Host = { id: string; reportedState?: { name?: string | null; hostname?: string | null } | null };

/** Every console (Cloud Key, Dream Machine, NVR) the key can reach. Not a console's call: /v1/hosts is the account's. */
export async function listConsoles(): Promise<UnifiConsole[]> {
  const hosts: Host[] = [];
  let next: string | undefined;
  do {
    const res = await call(`/v1/hosts?pageSize=100${next ? `&nextToken=${encodeURIComponent(next)}` : ""}`);
    if (!res.ok) throw new Error(`UniFi hosts: ${res.status}`);
    const body = (await res.json()) as { data?: Host[]; nextToken?: string | null };
    hosts.push(...(body.data ?? []));
    next = body.nextToken || undefined;
  } while (next && hosts.length < 500);
  return hosts.map((host) => ({ id: host.id, name: host.reportedState?.name || host.reportedState?.hostname || "UniFi" }));
}

type CameraJson = {
  id: string;
  name: string | null;
  state: string;
  type?: string | null;
  featureFlags?: { supportFullHdSnapshot?: boolean; smartDetectTypes?: unknown } | null;
  smartDetectSettings?: { objectTypes?: unknown } | null;
};

export type ProtectCamera = {
  id: string;
  name: string;
  /** The model as UniFi names it ("G5 Bullet"). */
  model: string | null;
  online: boolean;
  /** What the camera is switched on to detect now (smartDetectSettings.objectTypes). */
  detects: string[];
  /** What it could detect (featureFlags.smartDetectTypes). */
  canDetect: string[];
  /** Whether it can make a full HD photo through the API; null when UniFi does not say. */
  fullHd: boolean | null;
};

const strings = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);

/** The cameras on one console with what each detects. One call against its minute; null when it has no Protect. */
export async function consoleCameras(consoleId: string): Promise<ProtectCamera[] | null> {
  await takeCall(consoleId);
  const res = await call(protect(consoleId, "/cameras"));
  throwIfAskedToWait(consoleId, res);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`UniFi cameras: ${res.status}`);
  const cameras = (await res.json()) as CameraJson[];
  return cameras.map((camera) => ({
    id: camera.id,
    name: camera.name || camera.id,
    model: camera.type?.replace(/^UVC\s+/i, "").trim() || null,
    online: camera.state === "CONNECTED",
    detects: strings(camera.smartDetectSettings?.objectTypes),
    canDetect: strings(camera.featureFlags?.smartDetectTypes),
    fullHd: typeof camera.featureFlags?.supportFullHdSnapshot === "boolean" ? camera.featureFlags.supportFullHdSnapshot : null,
  }));
}

const isJpeg = (image: ArrayBuffer) => {
  const head = new Uint8Array(image, 0, Math.min(3, image.byteLength));
  return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
};

/** Cameras that said they cannot make a full HD photo: asked for the usual one at once after that. */
const NO_FULL_HD = new Set<string>();

export type CameraShot = {
  image: ArrayBuffer;
  type: string;
  /** The full HD photo, rather than the camera's usual one. */
  sharp: boolean;
  /** The camera just said it cannot make a full HD photo: worth remembering with the camera. */
  noFullHd: boolean;
  /** How long UniFi took, every try together. */
  ms: number;
  /** Calls this console has taken this minute, the last one included. */
  used: number;
};

/**
 * A photo of this moment: sharp (1080p or more) when the camera can, or its usual one when the sharp one fails
 * or takes too long. Every failure is logged with what UniFi answered, never with the key.
 */
export async function cameraSnapshot(consoleId: string, cameraId: string, fullHd: boolean | null = null): Promise<CameraShot> {
  const started = Date.now();
  let noFullHd = false;
  for (const sharp of fullHd === false || NO_FULL_HD.has(cameraId) ? [false] : [true, false]) {
    const used = await takeCall(consoleId);
    const path = protect(consoleId, `/cameras/${encodeURIComponent(cameraId)}/snapshot${sharp ? "?highQuality=true" : ""}`);
    try {
      const res = await call(path, "*/*", sharp ? 12_000 : TIMEOUT_MS);
      throwIfAskedToWait(consoleId, res);
      const image = await res.arrayBuffer();
      const type = res.headers.get("content-type") ?? "";
      if (res.ok && (type.startsWith("image/") || isJpeg(image))) {
        return { image, type: type.startsWith("image/") ? type : "image/jpeg", sharp, noFullHd, ms: Date.now() - started, used };
      }
      const said = type.includes("json") || type.startsWith("text/") ? new TextDecoder().decode(image.slice(0, 300)) : `${image.byteLength} bytes`;
      // UniFi's own answer for such a camera: "Camera does not support full HD snapshot".
      if (sharp && res.status === 400 && /full HD/i.test(said)) {
        NO_FULL_HD.add(cameraId);
        noFullHd = true;
        continue;
      }
      console.error("UniFi snapshot refused", { sharp, status: res.status, type, said });
    } catch (error) {
      if (error instanceof CameraBusyError) throw error;
      console.error("UniFi snapshot failed", { sharp, error: String(error) });
    }
  }
  throw new Error("UniFi snapshot failed");
}

/** cameraSnapshot, shared: whoever asks for the same camera within SHARE_MS gets the same photo and costs UniFi nothing. */
export const sharedSnapshot = sharing(
  (camera: { consoleId: string; cameraId: string; fullHd: boolean | null }) => `${camera.consoleId}/${camera.cameraId}`,
  (camera) => cameraSnapshot(camera.consoleId, camera.cameraId, camera.fullHd),
);

/**
 * The way to Protect's private API that worked on each console: /proxy/protect/api (tested by others on a live
 * console) or /protect/api, the form the official API answers to here. The first that is not a 404 is kept.
 */
const PRIVATE_BASE = new Map<string, string>();

/**
 * A GET on Protect's private API, for the event history the official API does not have. Through the connector
 * with the same key, against the console's minute like every other call. It is undocumented and a Protect update
 * can move it, so a failure carries what UniFi answered.
 */
export async function protectPrivate(consoleId: string, path: string): Promise<unknown> {
  const known = PRIVATE_BASE.get(consoleId);
  let said = "";
  for (const base of known ? [known] : ["/proxy/protect/api", "/protect/api"]) {
    await takeCall(consoleId);
    const res = await call(`/v1/connector/consoles/${encodeURIComponent(consoleId)}${base}${path}`);
    throwIfAskedToWait(consoleId, res);
    if (res.ok) {
      PRIVATE_BASE.set(consoleId, base);
      return res.json();
    }
    said = `${res.status} ${(await res.text()).slice(0, 200)}`;
    if (res.status !== 404) break;
  }
  throw new Error(`UniFi private API: ${said}`);
}
