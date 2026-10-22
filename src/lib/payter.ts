// Payter's cloud (MyPayter), read the way MATO Info's own sync reads it: log in with an account, then the
// Terminals index and the complete Transactions ordered by ingestTime from a watermark. Only what a sale needs is
// kept: terminal, selection, amount, approved, when. Never the card (maskedPAN and the rest of the document stop
// here). No other imports: the tests share it.
//
// More than one account (Xin, 22-10-2026: "2 apollo terminals … on another payter account and domain"): the first
// is PAYTER_USERNAME / PAYTER_PASSWORD / PAYTER_DOMAIN, the next ones PAYTER_2_USERNAME … PAYTER_5_DOMAIN.

const API = "https://api.mypayter.com/API";
const PAGE = 1000;
/** Payter's search stops at 10 000 results per query: start a new window from the newest ingestTime before that. */
const MAX_OFFSET = 8000;
const MAX_ACCOUNTS = 5;

export type PayterAccount = { id: number; username: string; password: string; domain: string };

/** Every Payter login set up, in order; one with a part missing is left out. */
export function payterAccounts(env: Record<string, string | undefined> = process.env): PayterAccount[] {
  const accounts: PayterAccount[] = [];
  for (let id = 1; id <= MAX_ACCOUNTS; id++) {
    const prefix = id === 1 ? "PAYTER_" : `PAYTER_${id}_`;
    const username = env[`${prefix}USERNAME`]?.trim();
    const password = env[`${prefix}PASSWORD`];
    const domain = env[`${prefix}DOMAIN`]?.trim();
    if (username && password && domain) accounts.push({ id, username, password, domain });
  }
  return accounts;
}

export function payterConfigured(): boolean {
  return payterAccounts().length > 0;
}

/** Where each account's progress is kept in ci_sync; the first keeps the names it had before there were more. */
export const salesSource = (account: Pick<PayterAccount, "id">) => (account.id === 1 ? "payter" : `payter:${account.id}`);
export const terminalsSource = (account: Pick<PayterAccount, "id">) => (account.id === 1 ? "payter-terminals" : `payter-terminals:${account.id}`);
export const isSalesSource = (source: string) => /^payter(:\d+)?$/.test(source);

/** Each account's login, kept for as long as this server runs and five minutes short of Payter's own expiry. */
const tokens = new Map<number, { id: string; until: number }>();

async function login(account: PayterAccount): Promise<string> {
  const known = tokens.get(account.id);
  if (known && known.until > Date.now()) return known.id;
  const res = await fetch(`${API}/Auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: account.username, password: account.password, domain: account.domain }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Payter login failed (${res.status})`);
  const auth = (await res.json()) as { tokenId?: string; expiresIn?: number };
  if (!auth.tokenId) throw new Error("Payter login gave no token");
  tokens.set(account.id, { id: auth.tokenId, until: Date.now() + Math.max(60, (auth.expiresIn ?? 3600) - 300) * 1000 });
  return auth.tokenId;
}

async function search(account: PayterAccount, body: Record<string, unknown>): Promise<unknown[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = await login(account);
    const res = await fetch(`${API}/Data`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `CURO-TOKEN token="${id}"` },
      body: JSON.stringify({ query: "", sorts: [], filters: [], aggregations: [], offset: 0, ...body }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    // An expired login: once more with a fresh one.
    if (res.status === 401 && attempt === 0) {
      tokens.delete(account.id);
      continue;
    }
    if (!res.ok) throw new Error(`Payter data request failed (${res.status})`);
    const json = (await res.json()) as { documents?: unknown[] };
    return Array.isArray(json.documents) ? json.documents : [];
  }
  throw new Error("Payter login refused");
}

const isoDate = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export type PayterTerminal = {
  serial: string;
  model: string | null;
  site: string | null;
  lastConnect: string | null;
  lastDisconnect: string | null;
};

/** A Terminals document as the few fields kept; null without a serial number. */
export function terminalRow(doc: unknown): PayterTerminal | null {
  if (!doc || typeof doc !== "object") return null;
  const t = doc as { serialNumber?: unknown; model?: { name?: unknown }; data?: Record<string, unknown>; lastConnected?: unknown };
  if (typeof t.serialNumber !== "string" || !t.serialNumber) return null;
  return {
    serial: t.serialNumber,
    model: typeof t.model?.name === "string" ? t.model.name : null,
    site: typeof t.data?.["Site Reference"] === "string" ? (t.data["Site Reference"] as string) : null,
    // Payter holds a standing connection and reconnects it nightly: the pair of dates tells whether it is up now.
    lastConnect: isoDate(t.data?.["Last Connect Date"] ?? t.lastConnected),
    lastDisconnect: isoDate(t.data?.["Last Disconnect Date"]),
  };
}

export async function fetchTerminals(account: PayterAccount): Promise<PayterTerminal[]> {
  const docs = await search(account, { index: "Terminals", maxResults: 200 });
  return docs.map(terminalRow).filter((t): t is PayterTerminal => t !== null);
}

/** Up now: connected since it last disconnected. */
export function terminalOnline(t: Pick<PayterTerminal, "lastConnect" | "lastDisconnect">): boolean {
  if (!t.lastConnect) return false;
  return !t.lastDisconnect || new Date(t.lastConnect) >= new Date(t.lastDisconnect);
}

export type SaleRow = {
  payter_id: string;
  serial: string;
  item_ref: string | null;
  amount: number;
  approved: boolean;
  occurred_at: string;
};

/**
 * A Transactions document as the sale kept, or null when it is not one. The amount is what was committed (a
 * declined payment has 0 there and its ask in requestedAmount), in cents; the selection only when it is a number
 * (a few approved sales carry "[]").
 */
export function saleRow(doc: unknown): SaleRow | null {
  if (!doc || typeof doc !== "object") return null;
  const t = doc as Record<string, unknown>;
  if (typeof t.id !== "string" || !t.id || typeof t.serialNumber !== "string" || !t.serialNumber) return null;
  const occurred = isoDate(t.txnTimestamp);
  if (!occurred) return null;
  const cents = [t.committedAmount, t.authorizedAmount, t.requestedAmount].find((v): v is number => typeof v === "number" && Number.isFinite(v)) ?? 0;
  return {
    payter_id: t.id,
    serial: t.serialNumber,
    item_ref: typeof t.itemRef === "string" && /^\d+$/.test(t.itemRef) ? t.itemRef : null,
    amount: Math.round(cents) / 100,
    approved: t.disposition === "APPROVED",
    occurred_at: occurred,
  };
}

/** When Payter received a document, in milliseconds: the watermark the next read starts from. */
export function ingestMs(doc: unknown): number | null {
  const value = doc && typeof doc === "object" ? (doc as { ingestTime?: unknown }).ingestTime : null;
  const ms = typeof value === "string" || typeof value === "number" ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Complete transactions from a watermark on, a page at a time, oldest first. The boundary document can come back
 * on the next page or run; storing on payter_id makes that harmless.
 */
export async function* transactionsSince(account: PayterAccount, fromIngestMs: number): AsyncGenerator<unknown[]> {
  let from = fromIngestMs;
  while (true) {
    let offset = 0;
    let newest = from;
    while (true) {
      const docs = await search(account, {
        index: "Transactions",
        maxResults: PAGE,
        offset,
        sorts: [{ field: "ingestTime", asc: true }],
        filters: [
          { type: "range", field: "ingestTime", from },
          { type: "term", field: "complete", matches: "true" },
        ],
      });
      if (docs.length === 0) return;
      yield docs;
      for (const doc of docs) newest = Math.max(newest, ingestMs(doc) ?? newest);
      if (docs.length < PAGE) return;
      offset += PAGE;
      if (offset > MAX_OFFSET) break;
    }
    if (newest === from) return;
    from = newest;
  }
}
