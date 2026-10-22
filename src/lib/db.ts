import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEMO } from "@/lib/demo";

// The app's server talks to its own ci_* tables with the service role; the browser never talks to the database.
// The project is shared with MATO Info (free), so this file is the one place that knows how to reach it: moving
// Camera Insights to a Supabase project of its own is a change of SUPABASE_URL and the key, nothing else.

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export type DatabaseProblem = "missing" | "invalidKey" | "unreachable";

/** Answered fine at this moment: no need to ask again for a minute (per server). */
let fineUntil = 0;

/**
 * Whether the database answers, and if not why, in words a setup can act on: the variables are not set, Supabase
 * refuses the key (a wrong value in SUPABASE_SERVICE_ROLE_KEY), or it does not answer. One small read at most once
 * a minute while it works, so every page can check it first.
 */
export async function databaseProblem(): Promise<DatabaseProblem | null> {
  if (DEMO || Date.now() < fineUntil) return null;
  if (!process.env.SUPABASE_URL?.trim() || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return "missing";
  try {
    const { error, status } = await db().from("ci_settings").select("key").limit(1);
    if (!error) {
      fineUntil = Date.now() + 60_000;
      return null;
    }
    console.error("Database check failed", { status, code: error.code, message: error.message });
    return status === 401 || status === 403 || /api key|jwt/i.test(error.message) ? "invalidKey" : "unreachable";
  } catch (error) {
    console.error("Database check failed", { error: String(error) });
    return "unreachable";
  }
}

/** The time zone every day, hour and weekday is counted in. */
export const TIME_ZONE = "Europe/Brussels";
