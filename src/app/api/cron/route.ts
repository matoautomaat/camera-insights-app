import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { db } from "@/lib/db";
import { runSync } from "@/lib/sync";

// The database's own clock (pg_cron job ci-sync) calls this every 10 minutes with the secret it made itself
// (ci_settings.cron_secret), so UniFi and Payter are read even when nobody has the app open. The answer comes
// straight away; the reading goes on after it.

export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(request: Request) {
  const given = request.headers.get("x-cron-secret") ?? "";
  const { data } = await db().from("ci_settings").select("value").eq("key", "cron_secret").maybeSingle();
  const expected = (data?.value as string | undefined) ?? "";
  if (!expected || !given || !same(given, expected)) return new Response("Unauthorized", { status: 401 });
  after(() => runSync({ tidy: true, budgetMs: 50_000 }));
  return Response.json({ ok: true });
}
