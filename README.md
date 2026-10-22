# Camera Insights

A small web app of its own, separate from MATO Info: every camera on your UniFi consoles (Cloud Key), what
UniFi Protect's own person detection saw at each one, and what your Payter terminals sold.

- **Overview**: visitors and sales for today, 7 days, 4 weeks or 3 months, every camera with its count, and
  *All cameras now* (one photo from each camera side by side).
- **A camera**: a photo of this moment, Live (a photo every 3 s for a minute), full screen; visitors per day,
  per hour and per weekday, time in view, who bought something (when a Payter terminal is linked), long stays
  (10 minutes or more: refilling or cleaning), and a camera check.
- **Sales**: revenue, items, per day, per hour, per weekday, best sellers by selection number, per terminal.
- **Settings**: which Payter terminals are yours, which terminal each camera looks at, hide cameras, language.

Figures only claim what they can carry: a rise or fall only when it is bigger than normal swing (otherwise
"about the same"), a busiest hour or day only when it really stands out, and "bought something" only when the
camera saw at least 90% of the sales. The rules are in `src/lib/stats.ts`.

## Privacy

No pictures, faces or ages are stored. From UniFi Protect only which camera saw a person and from when to when
(kept 400 days); from Payter only terminal, selection, amount, approved or not, and time — never the card.
Photos and Live go straight from the camera to the screen. Cameras that film people need a pictogram on site and
a declaration (in Belgium: aangiftecamera.be).

## How it runs

- Next.js on Vercel; the database is a set of `ci_*` tables in the existing Supabase project (free), with row
  level security on and only the server's service role allowed in. Moving to a Supabase project of its own is a
  matter of `SUPABASE_URL` and the key.
- UniFi through Ubiquiti's cloud (`api.ui.com`) with a Site Manager API key: nothing to open at the shop. The
  event history comes from Protect's private API through the same connector (undocumented; a Protect update can
  move it — the Settings page then shows the error).
- UniFi allows 100 calls a minute per console. This app counts its calls in the same table as MATO Info
  (`unifi_call_take`) and stops at 60, so MATO Info always keeps room.
- Every 10 minutes the database calls `/api/cron` (pg_cron job `ci-sync`, with a secret it made itself), so
  detections and sales are read even when nobody has the app open. Opening a page reads what is due too, and
  *Fetch now* reads everything.

## Setting it up

1. On Vercel: *Add New → Project*, import this repository (framework Next.js).
2. Under *Settings → Environment Variables* add the variables from `.env.example` (mark the keys and passwords
   as sensitive), then deploy.
3. Open the site, log in with `APP_PASSWORD`, tap *Fetch now*. Under *Settings*, follow your Payter terminals
   and tick the terminal each camera looks at.

## Working on it

```bash
npm install
npm test          # the logic, without UniFi, Payter or a database
npm run lint
npm run build
CI_DEMO=1 APP_PASSWORD=demo SUPABASE_SERVICE_ROLE_KEY=local npm run dev   # made-up figures, password "demo"
```

The database is described in `supabase/migrations/`. Changes there are only ever additive: the same Supabase
project runs MATO Info.
