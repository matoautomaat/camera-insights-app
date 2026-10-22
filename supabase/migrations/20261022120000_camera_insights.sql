-- Camera Insights: its own tables in the same Supabase project as MATO Info (free), all named ci_*.
-- Only additive: nothing of MATO Info is changed. Row level security is on and only the service role
-- (the app's server) may read or write; the browser never talks to the database.
-- The one thing shared with MATO Info is public.unifi_call_take: both count their calls against the
-- same UniFi console, so together they stay under UniFi's 100 calls a minute.

create table public.ci_consoles (
  console_id text primary key,
  name text,
  updated_at timestamptz not null default now()
);

create table public.ci_cameras (
  console_id text not null,
  camera_id text not null,
  name text not null,
  model text,
  online boolean not null default false,
  -- What the camera is set to detect now, and what it could detect.
  detects text[] not null default '{}',
  can_detect text[] not null default '{}',
  -- False once the camera refused a full HD photo: asked for the usual one straight away after that.
  full_hd boolean,
  -- Left out of the overview and the totals (a camera that looks at nothing useful).
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (console_id, camera_id)
);
create index ci_cameras_camera on public.ci_cameras (camera_id);

-- One person detection by UniFi Protect: which camera, what kind, from when to when. No picture,
-- no description, no face: the sync drops everything else before it gets here.
create table public.ci_events (
  console_id text not null,
  event_id text not null,
  camera_id text not null,
  kind text not null check (kind in ('zone', 'line', 'loiter')),
  objects text[] not null default '{}',
  started_at timestamptz not null,
  ended_at timestamptz,
  score smallint,
  primary key (console_id, event_id)
);
create index ci_events_camera_time on public.ci_events (camera_id, kind, started_at) include (ended_at, objects);

-- How far each source was read: 'protect:<console id>' or 'payter'.
create table public.ci_sync (
  source text primary key,
  synced_until timestamptz,
  watermark bigint,
  last_run timestamptz,
  last_error text,
  last_count integer not null default 0
);

-- Payter terminals on the account. Only the ones followed have their sales stored: the account also
-- sees terminals of other businesses.
create table public.ci_terminals (
  serial text primary key,
  name text,
  model text,
  site text,
  last_connect timestamptz,
  last_disconnect timestamptz,
  followed boolean not null default false,
  updated_at timestamptz not null default now()
);

-- One Payter payment: terminal, selection, amount, approved or not, when. Never the card.
create table public.ci_sales (
  payter_id text primary key,
  serial text not null,
  item_ref text,
  amount numeric(10, 2) not null,
  approved boolean not null,
  occurred_at timestamptz not null
);
create index ci_sales_serial_time on public.ci_sales (serial, occurred_at) include (amount, item_ref) where approved and amount > 0;
create index ci_sales_serial_all on public.ci_sales (serial, occurred_at);

-- Which Payter terminals a camera looks at.
create table public.ci_camera_terminals (
  camera_id text not null,
  serial text not null references public.ci_terminals (serial) on delete cascade,
  primary key (camera_id, serial)
);

-- Wrong passwords, by a hash of the address, to slow down guessing. Kept a day.
create table public.ci_login_failures (
  ip_hash text not null,
  at timestamptz not null default now()
);
create index ci_login_failures_at on public.ci_login_failures (ip_hash, at);

-- The app's own address and the secret the 10-minute sync below sends to it. The secret is made here and
-- never leaves the database and the app's server.
create table public.ci_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
insert into public.ci_settings (key, value) values ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex'));

do $$
declare t text;
begin
  foreach t in array array['ci_consoles', 'ci_cameras', 'ci_events', 'ci_sync', 'ci_terminals', 'ci_sales',
                           'ci_camera_terminals', 'ci_login_failures', 'ci_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- Visitors per camera over the last period_days (today included), against the same length before.
-- A visit is one person detection in a zone. A stay of 10 minutes or more is not a customer (someone
-- refilling or cleaning): it is counted apart, as a long stay, and listed.
create or replace function public.ci_visitors_report(camera_ids text[], period_days integer, tz text default 'Europe/Brussels')
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  cur_end timestamptz := now();
  cur_start timestamptz := (date_trunc('day', now() at time zone tz) - (greatest(period_days, 1) - 1) * interval '1 day') at time zone tz;
  prev_start timestamptz;
  prev_end timestamptz;
  cameras_json jsonb;
begin
  -- The same hours period_days earlier: today until now against yesterday until the same time.
  prev_start := ((cur_start at time zone tz) - greatest(period_days, 1) * interval '1 day') at time zone tz;
  prev_end := ((cur_end at time zone tz) - greatest(period_days, 1) * interval '1 day') at time zone tz;

  with cams as (
    select c.camera_id, c.ord from unnest(camera_ids) with ordinality as c(camera_id, ord)
  ),
  linked as (
    select ct.camera_id, ct.serial from ci_camera_terminals ct
    join ci_terminals t on t.serial = ct.serial and t.followed
    where ct.camera_id = any(camera_ids)
  ),
  zone as (
    select e.camera_id, e.started_at, e.ended_at,
      coalesce(e.ended_at, e.started_at) as until,
      e.started_at >= cur_start as is_current,
      e.ended_at is not null and e.ended_at - e.started_at >= interval '10 minutes' as long_stay
    from ci_events e
    join cams c on c.camera_id = e.camera_id
    where e.kind = 'zone' and 'person' = any(e.objects)
      and e.started_at >= prev_start and e.started_at < cur_end
      and (e.started_at < prev_end or e.started_at >= cur_start)
  ),
  visits as (select * from zone where not long_stay),
  sales as (
    select l.camera_id, s.occurred_at
    from linked l
    join ci_sales s on s.serial = l.serial
    where s.approved and s.amount > 0 and s.occurred_at >= cur_start and s.occurred_at < cur_end
  ),
  per_camera as (
    select c.ord, jsonb_build_object(
      'camera_id', c.camera_id,
      'visits', (select count(*) from visits v where v.camera_id = c.camera_id and v.is_current),
      'prev_visits', (select count(*) from visits v where v.camera_id = c.camera_id and not v.is_current),
      'long_stays', (select count(*) from zone z where z.camera_id = c.camera_id and z.is_current and z.long_stay),
      'long_list', coalesce((
        select jsonb_agg(jsonb_build_object('started_at', l.started_at, 'ended_at', l.ended_at) order by l.started_at desc)
        from (
          select z.started_at, z.ended_at from zone z
          where z.camera_id = c.camera_id and z.is_current and z.long_stay
          order by z.started_at desc limit 12
        ) l
      ), '[]'::jsonb),
      'first_event', (select min(e.started_at) from ci_events e where e.camera_id = c.camera_id),
      'last_event', (select max(e.started_at) from ci_events e where e.camera_id = c.camera_id),
      'events_24h', (select count(*) from ci_events e where e.camera_id = c.camera_id and e.started_at > now() - interval '24 hours'),
      'lines', (select count(*) from ci_events e where e.camera_id = c.camera_id and e.kind = 'line' and 'person' = any(e.objects) and e.started_at >= cur_start and e.started_at < cur_end),
      'prev_lines', (select count(*) from ci_events e where e.camera_id = c.camera_id and e.kind = 'line' and 'person' = any(e.objects) and e.started_at >= prev_start and e.started_at < prev_end),
      'loiters', (select count(*) from ci_events e where e.camera_id = c.camera_id and e.kind = 'loiter' and 'person' = any(e.objects) and e.started_at >= cur_start and e.started_at < cur_end),
      'by_day', coalesce((
        select jsonb_agg(jsonb_build_object('day', d.day, 'visits', d.n) order by d.day)
        from (
          select to_char(v.started_at at time zone tz, 'YYYY-MM-DD') as day, count(*) as n
          from visits v where v.camera_id = c.camera_id and v.is_current group by 1
        ) d
      ), '[]'::jsonb),
      'by_hour', coalesce((
        select jsonb_agg(jsonb_build_object('hour', h.hour, 'visits', h.n) order by h.hour)
        from (
          select extract(hour from v.started_at at time zone tz)::int as hour, count(*) as n
          from visits v where v.camera_id = c.camera_id and v.is_current group by 1
        ) h
      ), '[]'::jsonb),
      'by_weekday', coalesce((
        select jsonb_agg(jsonb_build_object('weekday', w.weekday, 'visits', w.n) order by w.weekday)
        from (
          select extract(isodow from v.started_at at time zone tz)::int as weekday, count(*) as n
          from visits v where v.camera_id = c.camera_id and v.is_current group by 1
        ) w
      ), '[]'::jsonb),
      'duration', (
        select jsonb_build_object(
          'n', count(*),
          'p25', percentile_cont(0.25) within group (order by d.secs),
          'p50', percentile_cont(0.5) within group (order by d.secs),
          'p75', percentile_cont(0.75) within group (order by d.secs)
        )
        from (
          select extract(epoch from (v.ended_at - v.started_at)) as secs
          from visits v
          where v.camera_id = c.camera_id and v.is_current and v.ended_at > v.started_at
        ) d
      ),
      'sales', case
        when not exists (select 1 from linked l where l.camera_id = c.camera_id) then null
        else jsonb_build_object(
          'total', (select count(*) from sales s where s.camera_id = c.camera_id),
          'seen', (
            select count(*) from sales s
            where s.camera_id = c.camera_id and exists (
              select 1 from ci_events e
              where e.camera_id = s.camera_id and e.kind = 'zone' and 'person' = any(e.objects)
                and e.started_at between s.occurred_at - interval '2 hours' and s.occurred_at + interval '20 seconds'
                and coalesce(e.ended_at, e.started_at) + interval '60 seconds' >= s.occurred_at
            )
          ),
          'bought', (
            select count(*) from visits v
            where v.camera_id = c.camera_id and v.is_current and exists (
              select 1 from linked l
              join ci_sales s on s.serial = l.serial
              where l.camera_id = v.camera_id and s.approved and s.amount > 0
                and s.occurred_at between v.started_at - interval '20 seconds' and v.until + interval '60 seconds'
            )
          ),
          'attributed', (
            select count(*) from sales s
            where s.camera_id = c.camera_id and exists (
              select 1 from visits v
              where v.camera_id = s.camera_id and v.is_current
                and s.occurred_at between v.started_at - interval '20 seconds' and v.until + interval '60 seconds'
            )
          )
        )
      end
    ) as report
    from cams c
  )
  select coalesce(jsonb_agg(report order by ord), '[]'::jsonb) into cameras_json from per_camera;

  return jsonb_build_object(
    'cur_start', cur_start,
    'cur_end', cur_end,
    'prev_start', prev_start,
    'prev_end', prev_end,
    'timezone', tz,
    'cameras', cameras_json
  );
end;
$$;

-- Payter sales per terminal over the last period_days (today included), against the same length before.
create or replace function public.ci_sales_report(serials text[], period_days integer, tz text default 'Europe/Brussels')
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  cur_end timestamptz := now();
  cur_start timestamptz := (date_trunc('day', now() at time zone tz) - (greatest(period_days, 1) - 1) * interval '1 day') at time zone tz;
  prev_start timestamptz;
  prev_end timestamptz;
  terminals_json jsonb;
begin
  -- The same hours period_days earlier: today until now against yesterday until the same time.
  prev_start := ((cur_start at time zone tz) - greatest(period_days, 1) * interval '1 day') at time zone tz;
  prev_end := ((cur_end at time zone tz) - greatest(period_days, 1) * interval '1 day') at time zone tz;

  with terms as (
    select t.serial, t.ord from unnest(serials) with ordinality as t(serial, ord)
  ),
  sold as (
    select s.serial, s.occurred_at, s.amount, s.item_ref, s.occurred_at >= cur_start as is_current
    from ci_sales s
    join terms t on t.serial = s.serial
    where s.approved and s.amount > 0 and s.occurred_at >= prev_start and s.occurred_at < cur_end
      and (s.occurred_at < prev_end or s.occurred_at >= cur_start)
  ),
  per_terminal as (
    select t.ord, jsonb_build_object(
      'serial', t.serial,
      'units', (select count(*) from sold s where s.serial = t.serial and s.is_current),
      'revenue', (select coalesce(sum(s.amount), 0) from sold s where s.serial = t.serial and s.is_current),
      'prev_units', (select count(*) from sold s where s.serial = t.serial and not s.is_current),
      'prev_revenue', (select coalesce(sum(s.amount), 0) from sold s where s.serial = t.serial and not s.is_current),
      'declined', (select count(*) from ci_sales s where s.serial = t.serial and not s.approved and s.occurred_at >= cur_start and s.occurred_at < cur_end),
      'first_sale', (select min(s.occurred_at) from ci_sales s where s.serial = t.serial and s.approved and s.amount > 0),
      'last_sale', (select max(s.occurred_at) from ci_sales s where s.serial = t.serial and s.approved and s.amount > 0),
      'by_day', coalesce((
        select jsonb_agg(jsonb_build_object('day', d.day, 'units', d.units, 'revenue', d.revenue) order by d.day)
        from (
          select to_char(s.occurred_at at time zone tz, 'YYYY-MM-DD') as day, count(*) as units, sum(s.amount) as revenue
          from sold s where s.serial = t.serial and s.is_current group by 1
        ) d
      ), '[]'::jsonb),
      'by_hour', coalesce((
        select jsonb_agg(jsonb_build_object('hour', h.hour, 'units', h.units, 'revenue', h.revenue) order by h.hour)
        from (
          select extract(hour from s.occurred_at at time zone tz)::int as hour, count(*) as units, sum(s.amount) as revenue
          from sold s where s.serial = t.serial and s.is_current group by 1
        ) h
      ), '[]'::jsonb),
      'by_weekday', coalesce((
        select jsonb_agg(jsonb_build_object('weekday', w.weekday, 'units', w.units, 'revenue', w.revenue) order by w.weekday)
        from (
          select extract(isodow from s.occurred_at at time zone tz)::int as weekday, count(*) as units, sum(s.amount) as revenue
          from sold s where s.serial = t.serial and s.is_current group by 1
        ) w
      ), '[]'::jsonb),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('item_ref', i.item_ref, 'units', i.units, 'revenue', i.revenue) order by i.units desc, i.item_ref)
        from (
          select coalesce(s.item_ref, '?') as item_ref, count(*) as units, sum(s.amount) as revenue
          from sold s where s.serial = t.serial and s.is_current group by 1
        ) i
      ), '[]'::jsonb)
    ) as report
    from terms t
  )
  select coalesce(jsonb_agg(report order by ord), '[]'::jsonb) into terminals_json from per_terminal;

  return jsonb_build_object(
    'cur_start', cur_start,
    'cur_end', cur_end,
    'prev_start', prev_start,
    'prev_end', prev_end,
    'timezone', tz,
    'terminals', terminals_json
  );
end;
$$;

revoke all on function public.ci_visitors_report(text[], integer, text) from public, anon, authenticated;
revoke all on function public.ci_sales_report(text[], integer, text) from public, anon, authenticated;
grant execute on function public.ci_visitors_report(text[], integer, text) to service_role;
grant execute on function public.ci_sales_report(text[], integer, text) to service_role;

-- Every 10 minutes the app reads UniFi and Payter, also when nobody has it open. Nothing happens until
-- the app has written its own address (app_url) on its first visit in production.
select cron.schedule('ci-sync', '*/10 * * * *', $cron$
  select net.http_get(
    url := (select value from public.ci_settings where key = 'app_url') || '/api/cron',
    headers := jsonb_build_object('x-cron-secret', (select value from public.ci_settings where key = 'cron_secret')),
    timeout_milliseconds := 5000
  )
  where exists (select 1 from public.ci_settings where key = 'app_url');
$cron$);

-- Detections are kept 400 days and wrong passwords a day: the app's own sync (/api/cron) clears older rows.
