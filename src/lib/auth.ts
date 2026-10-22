import { createHash, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { DEMO } from "@/lib/demo";
import { SESSION_COOKIE, sessionExpiry, signSession } from "@/lib/session";

// The server side of the login. Every page and action checks the cookie itself too (the proxy is the first
// check, not the only one).

/** Wrong passwords per address, and for everyone together, in WINDOW_MS before the login is refused for a while. */
const PER_ADDRESS = 8;
const OVERALL = 40;
const WINDOW_MS = 15 * 60_000;

const sha256 = (text: string) => createHash("sha256").update(text).digest();

export function passwordConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

function passwordMatches(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  return timingSafeEqual(sha256(input), sha256(expected));
}

/** The visitor's address as a hash: enough to slow down one guesser, nothing to know who it was. */
async function addressHash(): Promise<string> {
  const list = await headers();
  const ip = list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip") || "unknown";
  return sha256(`${ip}\u0000${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`).toString("hex").slice(0, 32);
}

export type LoginResult = "ok" | "wrong" | "tooMany" | "notSetUp";

/** Checks the password, counts a wrong one, and on a right one sets the session cookie. */
export async function logIn(password: string): Promise<LoginResult> {
  if (!passwordConfigured()) return "notSetUp";
  if (DEMO) return passwordMatches(password) ? setSession() : "wrong";
  const ipHash = await addressHash();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const [mine, everyone] = await Promise.all([
    db().from("ci_login_failures").select("ip_hash", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("at", since),
    db().from("ci_login_failures").select("ip_hash", { count: "exact", head: true }).gte("at", since),
  ]);
  if ((mine.count ?? 0) >= PER_ADDRESS || (everyone.count ?? 0) >= OVERALL) return "tooMany";
  if (!passwordMatches(password)) {
    await db().from("ci_login_failures").insert({ ip_hash: ipHash });
    // A little wait makes guessing slower still, and costs a person who mistyped nothing.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return "wrong";
  }
  return setSession();
}

async function setSession(): Promise<"ok"> {
  const session = await signSession();
  (await cookies()).set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expires,
  });
  return "ok";
}

export async function logOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function isLoggedIn(): Promise<boolean> {
  return (await sessionExpiry((await cookies()).get(SESSION_COOKIE)?.value)) !== null;
}

/** For every page and action: without a valid login, to the login page. */
export async function requireLogin(): Promise<void> {
  if (!(await isLoggedIn())) redirect("/login");
}
