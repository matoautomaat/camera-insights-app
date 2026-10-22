import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

/** The time zone every day, hour and weekday is counted in. */
export const TIME_ZONE = "Europe/Brussels";
