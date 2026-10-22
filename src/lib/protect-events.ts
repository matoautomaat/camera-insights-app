// Person detections from UniFi Protect's own AI. Protect's official API only streams events live on the shop
// network; its private event list answers "what happened" through Ubiquiti's cloud connector, with the same Site
// Manager key as the photos. Read the way the uiprotect library (Home Assistant) and a connector-tested client read
// it. No imports: the sync and the tests share this file.

/** Protect's event types Camera Insights reads, and what each is called here. */
const KINDS = {
  smartDetectZone: "zone",
  smartDetectLine: "line",
  smartDetectLoiterZone: "loiter",
} as const;

export type ProtectKind = (typeof KINDS)[keyof typeof KINDS];

export const PROTECT_EVENT_TYPES = Object.keys(KINDS) as (keyof typeof KINDS)[];

/** At most this many events per question; a full page means there are more. */
export const EVENTS_PAGE = 500;

export type ProtectEvent = {
  eventId: string;
  cameraId: string;
  kind: ProtectKind;
  /** What Protect saw: "person", sometimes with others. */
  objects: string[];
  startedAt: string;
  /** Null while the detection is still going on. */
  endedAt: string | null;
  score: number | null;
};

/**
 * The query for one page of person detections between two moments. Times in
 * milliseconds (a value in seconds reads as 1970 and silently finds nothing),
 * every type named (without types Protect pages the list wrongly), and oldest
 * first, so a page that comes back full can be continued with an offset.
 */
export function eventsQuery(fromMs: number, toMs: number, offset = 0): string {
  const query = new URLSearchParams({
    start: String(Math.floor(fromMs)),
    end: String(Math.ceil(toMs)),
    limit: String(EVENTS_PAGE),
    offset: String(offset),
    orderDirection: "ASC",
    withoutDescriptions: "true",
  });
  for (const type of PROTECT_EVENT_TYPES) query.append("types", type);
  query.append("smartDetectTypes", "person");
  return query.toString();
}

const EARLIEST = Date.UTC(2015, 0, 1);

/**
 * Protect's answer as the detections Camera Insights keeps: camera, kind, from when to
 * when, what it saw. Everything else in the answer (thumbnails, heatmaps,
 * descriptions) stops here, so no image or description of a person ever reaches
 * the database. An item that is not a readable detection is skipped, never
 * guessed. `received` counts every item, read or not, to know whether a page
 * was full; `lastStart` is the newest start seen, to continue from.
 */
export function parseProtectEvents(
  body: unknown,
  now: number = Date.now(),
): { events: ProtectEvent[]; received: number; lastStart: number | null } {
  const list: unknown[] = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : [];
  const events: ProtectEvent[] = [];
  let lastStart: number | null = null;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const start = typeof raw.start === "number" ? raw.start : NaN;
    if (!(start > EARLIEST && start < now + 86_400_000)) continue;
    lastStart = Math.max(lastStart ?? start, start);
    const kind = KINDS[raw.type as keyof typeof KINDS];
    const camera =
      typeof raw.camera === "string"
        ? raw.camera
        : raw.camera && typeof raw.camera === "object" && typeof (raw.camera as { id?: unknown }).id === "string"
          ? (raw.camera as { id: string }).id
          : null;
    if (!kind || typeof raw.id !== "string" || !raw.id || !camera) continue;
    const end = typeof raw.end === "number" && raw.end >= start ? raw.end : null;
    const objects = Array.isArray(raw.smartDetectTypes)
      ? raw.smartDetectTypes.filter((type): type is string => typeof type === "string")
      : [];
    events.push({
      eventId: raw.id,
      cameraId: camera,
      kind,
      objects,
      startedAt: new Date(start).toISOString(),
      endedAt: end === null ? null : new Date(end).toISOString(),
      score: typeof raw.score === "number" && Number.isFinite(raw.score) ? Math.round(raw.score) : null,
    });
  }
  return { events, received: list.length, lastStart };
}
