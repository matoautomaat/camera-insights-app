// The login: one password (APP_PASSWORD), and a signed cookie that says until when this browser is let in.
// Web Crypto only, so the proxy and the server share this file. The signing key comes from SESSION_SECRET, or
// else from the password and the database key together: changing the password logs every browser out.

export const SESSION_COOKIE = "ci-session";
/** How long a login lasts; it is renewed while it is used, so a phone in daily use never has to log in again. */
export const SESSION_DAYS = 60;
const RENEW_BELOW_MS = 30 * 86_400_000;

const encoder = new TextEncoder();

function secret(): string | null {
  const own = process.env.SESSION_SECRET?.trim();
  if (own) return own;
  const password = process.env.APP_PASSWORD;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return password && key ? `${password}\u0000${key}` : null;
}

async function signingKey(): Promise<CryptoKey | null> {
  const value = secret();
  if (!value) return null;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`camera-insights-session\u0000${value}`));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** A new session cookie value: "<expires ms>.<signature>". */
export async function signSession(now: number = Date.now()): Promise<{ value: string; expires: Date }> {
  const key = await signingKey();
  if (!key) throw new Error("APP_PASSWORD is not set");
  const expires = now + SESSION_DAYS * 86_400_000;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(String(expires)));
  return { value: `${expires}.${toBase64Url(signature)}`, expires: new Date(expires) };
}

/** Until when a cookie value lets this browser in, or null when it is not one of ours or has run out. */
export async function sessionExpiry(value: string | undefined, now: number = Date.now()): Promise<number | null> {
  if (!value) return null;
  const [expires, signature] = value.split(".");
  if (!/^\d{13}$/.test(expires ?? "") || !signature) return null;
  const key = await signingKey();
  const bytes = fromBase64Url(signature);
  if (!key || !bytes) return null;
  const valid = await crypto.subtle.verify("HMAC", key, bytes, encoder.encode(expires));
  const until = Number(expires);
  return valid && until > now ? until : null;
}

/** Whether a valid session should get a fresh cookie now. */
export const shouldRenew = (expires: number, now: number = Date.now()) => expires - now < RENEW_BELOW_MS;
