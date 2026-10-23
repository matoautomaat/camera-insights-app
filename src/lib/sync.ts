import { db } from "@/lib/db";
import { fetchTerminals, ingestMs, payterAccounts, saleRow, salesSource, terminalsSource, transactionsSince, type PayterAccount } from "@/lib/payter";
import { EVENTS_PAGE, eventsQuery, parseProtectEvents } from "@/lib/protect-events";
import { CameraBusyError, consoleCameras, listConsoles, protectPrivate, unifiConfigured } from "@/lib/unifi";

// Reading UniFi and Payter into the ci_* tables. Runs after a page is shown (at most this often, see the
// constants), every 10 minutes from the database's own clock (/api/cron), and on "Fetch now". Never throws: how
// each source went is stored in ci_sync, and the next run carries on from what was read.

const MINUTE = 60_000;
const DAY_MS = 86_400_000;
/** The list of consoles changes rarely. */
const CONSOLES_EVERY_MS = 60 * MINUTE;
/** A console's cameras and detections. */
const CONSOLE_EVERY_MS = 5 * MINUTE;
const PAYTER_EVERY_MS = 2 * MINUTE;
const TERMINALS_EVERY_MS = 60 * MINUTE;
/** The first read of a console goes back this far; Protect keeps its events for a while, not for ever. */
const BACKFILL_DAYS = 30;
/** Pages per run, each one call of the console's minute: a long first read finishes over a few runs. */
const MAX_PAGES = 8;
/** Every run reads the last half hour again: a detection still going on then has its end by now. */
const OVERLAP_MS = 30 * MINUTE;
/** Detections are kept this long, wrong passwords a day. */
const KEEP_EVENTS_DAYS = 400;

export type SyncState = {
  source: string;
  syncedUntil: string | null;
  watermark: number | null;
  lastRun: string | null;
  lastError: string | null;
  lastCount: number;
};

type SyncRow = { source: string; synced_until: string | null; watermark: number | null; last_run: string | null; last_error: string | null; last_count: number };

export async function readSyncStates(): Promise<SyncState[]> {
  const { data, error } = await db().from("ci_sync").select("source, synced_until, watermark, last_run, last_error, last_count");
  if (error) throw new Error(error.message);
  return ((data ?? []) as SyncRow[]).map((row) => ({
    source: row.source,
    syncedUntil: row.synced_until,
    watermark: row.watermark === null ? null : Number(row.watermark),
    lastRun: row.last_run,
    lastError: row.last_error,
    lastCount: row.last_count,
  }));
}

const due = (state: SyncState | undefined, every: number, now: number) => !state?.lastRun || now - new Date(state.lastRun).getTime() >= every;

async function saveState(source: string, fields: Partial<Omit<SyncRow, "source">>) {
  const { error } = await db().from("ci_sync").upsert({ source, ...fields }, { onConflict: "source" });
  if (error) console.error("Sync state not saved", { source, error: error.message });
}

const describe = (error: unknown) => (error instanceof CameraBusyError ? "busy" : String(error instanceof Error ? error.message : error).slice(0, 300));

/** The consoles on the account, kept in ci_consoles. */
async function syncConsoles(now: number) {
  try {
    const consoles = await listConsoles();
    if (consoles.length) {
      const { error } = await db()
        .from("ci_consoles")
        .upsert(consoles.map((c) => ({ console_id: c.id, name: c.name, updated_at: new Date(now).toISOString() })), { onConflict: "console_id" });
      if (error) throw new Error(error.message);
    }
    await saveState("consoles", { last_run: new Date(now).toISOString(), last_error: null, last_count: consoles.length });
  } catch (error) {
    console.error("UniFi consoles not read", { error: describe(error) });
    await saveState("consoles", { last_run: new Date(now).toISOString(), last_error: describe(error) });
  }
}

/**
 * One console: its cameras, then the person detections since the last read (or the last BACKFILL_DAYS the first
 * time), oldest first, MAX_PAGES at most.
 */
async function syncConsole(consoleId: string, previous: SyncState | undefined, now: number) {
  const source = `protect:${consoleId}`;
  const before = previous?.syncedUntil ? new Date(previous.syncedUntil).getTime() : null;
  const from = Math.max(before !== null ? before - OVERLAP_MS : 0, now - BACKFILL_DAYS * DAY_MS);
  let reached = before ?? from;
  let count = 0;
  let failure: string | null = null;
  // Marked as read now, before reading: a page opened meanwhile sees it fresh and does not read it again.
  await saveState(source, { synced_until: new Date(reached).toISOString(), last_run: new Date(now).toISOString() });
  try {
    const cameras = await consoleCameras(consoleId);
    if (cameras === null) {
      // A console without Protect (a gateway, a switch): nothing to read, and nothing wrong.
      await saveState(source, { last_run: new Date(now).toISOString(), last_error: null, last_count: 0 });
      return;
    }
    if (cameras.length) {
      const stamp = new Date(now).toISOString();
      const { error } = await db()
        .from("ci_cameras")
        .upsert(
          cameras.map((c) => ({
            console_id: consoleId,
            camera_id: c.id,
            name: c.name,
            model: c.model,
            online: c.online,
            detects: c.detects,
            can_detect: c.canDetect,
            updated_at: stamp,
          })),
          { onConflict: "console_id,camera_id" },
        );
      if (error) throw new Error(error.message);
      const noFullHd = cameras.filter((c) => c.fullHd === false).map((c) => c.id);
      if (noFullHd.length) await db().from("ci_cameras").update({ full_hd: false }).eq("console_id", consoleId).in("camera_id", noFullHd);
      // A camera taken off the console stays with its history, shown as offline.
      await db()
        .from("ci_cameras")
        .update({ online: false })
        .eq("console_id", consoleId)
        .not("camera_id", "in", `(${cameras.map((c) => `"${c.id.replace(/"/g, "")}"`).join(",")})`);
    }
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await protectPrivate(consoleId, `/events?${eventsQuery(from, now, page * EVENTS_PAGE)}`);
      const { events, received, lastStart } = parseProtectEvents(body, now);
      if (events.length) {
        const { error } = await db()
          .from("ci_events")
          .upsert(
            events.map((e) => ({
              console_id: consoleId,
              event_id: e.eventId,
              camera_id: e.cameraId,
              kind: e.kind,
              objects: e.objects,
              started_at: e.startedAt,
              ended_at: e.endedAt,
              score: e.score,
              line_detail: e.lineDetail,
              people: e.people,
            })),
            { onConflict: "console_id,event_id" },
          );
        if (error) throw new Error(error.message);
      }
      count += events.length;
      if (received < EVENTS_PAGE) {
        reached = now;
        break;
      }
      // A full page: more to read. If this was the last page allowed, the next run starts at its newest event.
      reached = lastStart ?? reached;
    }
  } catch (error) {
    failure = describe(error);
    console.error("Protect events not read", { consoleId, error: failure });
  }
  await saveState(source, { synced_until: new Date(reached).toISOString(), last_run: new Date(now).toISOString(), last_error: failure, last_count: count });
}

/** One account's Payter terminals, without touching the name given here or whether it is followed. */
async function syncTerminals(account: PayterAccount, now: number) {
  const source = terminalsSource(account);
  try {
    const terminals = await fetchTerminals(account);
    if (terminals.length) {
      const { error } = await db()
        .from("ci_terminals")
        .upsert(
          terminals.map((t) => ({
            serial: t.serial,
            model: t.model,
            site: t.site,
            last_connect: t.lastConnect,
            last_disconnect: t.lastDisconnect,
            account: account.id,
            updated_at: new Date(now).toISOString(),
          })),
          { onConflict: "serial" },
        );
      if (error) throw new Error(error.message);
    }
    await saveState(source, { last_run: new Date(now).toISOString(), last_error: null, last_count: terminals.length });
  } catch (error) {
    console.error("Payter terminals not read", { account: account.id, error: describe(error) });
    await saveState(source, { last_run: new Date(now).toISOString(), last_error: describe(error) });
  }
}

/**
 * One account's sales of the followed terminals since its watermark, page by page until the deadline. The watermark
 * moves on every document, followed or not, so another business's sales are never read twice and never stored. An
 * account none of whose terminals is followed is not read at all.
 */
async function syncSales(account: PayterAccount, previous: SyncState | undefined, now: number, deadline: number) {
  const source = salesSource(account);
  let watermark = previous?.watermark ?? 0;
  let count = 0;
  let failure: string | null = null;
  await saveState(source, { last_run: new Date(now).toISOString() });
  try {
    const { data, error } = await db().from("ci_terminals").select("serial").eq("followed", true).eq("account", account.id);
    if (error) throw new Error(error.message);
    const followed = new Set((data ?? []).map((row) => row.serial as string));
    if (followed.size) {
      for await (const page of transactionsSince(account, watermark)) {
        const rows = page.map(saleRow).filter((row): row is NonNullable<typeof row> => row !== null && followed.has(row.serial));
        if (rows.length) {
          const { error: upsertError } = await db().from("ci_sales").upsert(rows, { onConflict: "payter_id" });
          if (upsertError) throw new Error(upsertError.message);
          count += rows.length;
        }
        for (const doc of page) watermark = Math.max(watermark, ingestMs(doc) ?? watermark);
        // Saved per page, so a run that is cut off loses at most one page.
        await saveState(source, { watermark, synced_until: new Date(watermark).toISOString() });
        if (Date.now() > deadline) break;
      }
    }
  } catch (error) {
    failure = describe(error);
    console.error("Payter sales not read", { account: account.id, error: failure });
  }
  await saveState(source, { watermark, last_run: new Date(now).toISOString(), last_error: failure, last_count: count });
}

/** The app's own address, so the database's 10-minute clock can call /api/cron. Only the production site. */
async function rememberAddress() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (process.env.VERCEL_ENV !== "production" || !host) return;
  const url = `https://${host.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  const { data } = await db().from("ci_settings").select("value").eq("key", "app_url").maybeSingle();
  if (data?.value === url) return;
  await db().from("ci_settings").upsert({ key: "app_url", value: url, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

/** Old detections and wrong passwords out. */
async function keepTidy(now: number) {
  await db().from("ci_events").delete().lt("started_at", new Date(now - KEEP_EVENTS_DAYS * DAY_MS).toISOString());
  await db().from("ci_login_failures").delete().lt("at", new Date(now - DAY_MS).toISOString());
}

/**
 * Everything that is due, or everything when forced. The consoles are read side by side (each has its own
 * minute at UniFi), Payter alongside them, all within budgetMs.
 */
export async function runSync({ force = false, tidy = false, budgetMs = 45_000 }: { force?: boolean; tidy?: boolean; budgetMs?: number } = {}): Promise<void> {
  const now = Date.now();
  const deadline = now + budgetMs;
  try {
    const states = await readSyncStates();
    const state = (source: string) => states.find((s) => s.source === source);
    await rememberAddress().catch((error) => console.error("Address not saved", { error: String(error) }));

    const work: Promise<void>[] = [];
    if (unifiConfigured()) {
      if (force || due(state("consoles"), CONSOLES_EVERY_MS, now)) await syncConsoles(now);
      const { data } = await db().from("ci_consoles").select("console_id");
      for (const row of data ?? []) {
        const id = row.console_id as string;
        const previous = state(`protect:${id}`);
        if (force || due(previous, CONSOLE_EVERY_MS, now)) work.push(syncConsole(id, previous, now));
      }
    }
    for (const account of payterAccounts()) {
      work.push(
        (async () => {
          if (force || due(state(terminalsSource(account)), TERMINALS_EVERY_MS, now)) await syncTerminals(account, now);
          if (force || due(state(salesSource(account)), PAYTER_EVERY_MS, now)) await syncSales(account, state(salesSource(account)), now, deadline);
        })(),
      );
    }
    await Promise.all(work);
    if (tidy) await keepTidy(now);
  } catch (error) {
    console.error("Sync failed", { error: String(error) });
  }
}
