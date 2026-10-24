-- Camera Insights: a period can end before today (Xin, 24-10-2026: "data van gisteren ook"). Each report gets a
-- version with days_back: 0 is up to now, 1 is the whole of yesterday against the day before, as before the same
-- hours. The three-argument versions stay as they were (up to now), so nothing that calls them changes. Only ci_*.

create or replace function public.ci_visitors_report(camera_ids text[], period_days integer, tz text, days_back integer)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  -- days_back 0: up to now; 1: the whole of yesterday; n: the day n days ago, and the days before it in the period.
  cur_end timestamptz := case when days_back > 0
    then (date_trunc('day', now() at time zone tz) - (days_back - 1) * interval '1 day') at time zone tz else now() end;
  cur_start timestamptz := (date_trunc('day', now() at time zone tz) - (greatest(days_back, 0) + greatest(period_days, 1) - 1) * interval '1 day') at time zone tz;
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

revoke all on function public.ci_visitors_report(text[], integer, text, integer) from public, anon, authenticated;
grant execute on function public.ci_visitors_report(text[], integer, text, integer) to service_role;

create or replace function public.ci_sales_report(serials text[], period_days integer, tz text, days_back integer)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  -- days_back 0: up to now; 1: the whole of yesterday; n: the day n days ago, and the days before it in the period.
  cur_end timestamptz := case when days_back > 0
    then (date_trunc('day', now() at time zone tz) - (days_back - 1) * interval '1 day') at time zone tz else now() end;
  cur_start timestamptz := (date_trunc('day', now() at time zone tz) - (greatest(days_back, 0) + greatest(period_days, 1) - 1) * interval '1 day') at time zone tz;
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

revoke all on function public.ci_sales_report(text[], integer, text, integer) from public, anon, authenticated;
grant execute on function public.ci_sales_report(text[], integer, text, integer) to service_role;

create or replace function public.ci_entrances_report(camera_ids text[], period_days integer, tz text, days_back integer)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  -- days_back 0: up to now; 1: the whole of yesterday; n: the day n days ago, and the days before it in the period.
  cur_end timestamptz := case when days_back > 0
    then (date_trunc('day', now() at time zone tz) - (days_back - 1) * interval '1 day') at time zone tz else now() end;
  cur_start timestamptz := (date_trunc('day', now() at time zone tz) - (greatest(days_back, 0) + greatest(period_days, 1) - 1) * interval '1 day') at time zone tz;
  prev_start timestamptz;
  prev_end timestamptz;
  result jsonb;
begin
  -- The same hours period_days earlier: today until now against yesterday until the same time.
  prev_start := ((cur_start at time zone tz) - greatest(period_days, 1) * interval '1 day') at time zone tz;
  prev_end := ((cur_end at time zone tz) - greatest(period_days, 1) * interval '1 day') at time zone tz;

  with doors as (
    select c.camera_id, c.console_id from ci_cameras c where c.camera_id = any(camera_ids)
  ),
  place as (
    select k.camera_id from ci_cameras k where not k.hidden and k.console_id in (select console_id from doors)
    union
    select camera_id from doors
  ),
  machines as (
    select distinct t.serial
    from ci_camera_terminals l
    join place p on p.camera_id = l.camera_id
    join ci_terminals t on t.serial = l.serial
    where t.followed
  ),
  seen as (
    -- From an hour before the earlier period, so a visit that began just before it is whole.
    select e.camera_id, e.started_at, greatest(coalesce(e.ended_at, e.started_at), e.started_at) as ended_at
    from ci_events e
    join place p on p.camera_id = e.camera_id
    where e.kind = 'zone' and 'person' = any(e.objects)
      and e.started_at >= prev_start - interval '1 hour' and e.started_at < cur_end
  ),
  marked as (
    select camera_id, started_at, ended_at,
      case when started_at - max(ended_at) over (order by started_at, ended_at rows between unbounded preceding and 1 preceding)
        <= interval '90 seconds' then 0 else 1 end as new_visit
    from seen
  ),
  numbered as (
    select camera_id, started_at, ended_at, sum(new_visit) over (order by started_at, ended_at rows unbounded preceding) as visit
    from marked
  ),
  visits as (
    select visit, min(started_at) as s, max(ended_at) as e, bool_or(camera_id in (select camera_id from doors)) as door
    from numbered group by visit
  ),
  since as (
    -- Sales count only from the first detection at the door: before it there are no visits to set them against.
    select min(e.started_at) as at from ci_events e join doors d on d.camera_id = e.camera_id
    where e.kind = 'zone' and 'person' = any(e.objects)
  ),
  sold as (
    select x.serial, coalesce(nullif(x.item_ref, ''), '?') as item_ref, x.amount, x.occurred_at, x.occurred_at >= cur_start as is_current
    from ci_sales x
    join machines m on m.serial = x.serial
    where x.approved and x.amount > 0 and x.occurred_at >= prev_start and x.occurred_at < cur_end
      and (x.occurred_at < prev_end or x.occurred_at >= cur_start)
      and x.occurred_at >= coalesce((select at from since), cur_end)
  ),
  bought_or_not as (
    select v.s as started_at, v.e as ended_at, extract(epoch from v.e - v.s) as seconds, v.s >= cur_start as is_current,
      v.e - v.s >= interval '10 minutes' as is_long,
      exists (select 1 from sold x where x.occurred_at between v.s - interval '20 seconds' and v.e + interval '60 seconds') as bought
    from visits v
    where v.door and v.s >= prev_start and v.s < cur_end and (v.s < prev_end or v.s >= cur_start)
  ),
  counted as (
    -- 10 minutes or more without a sale is staff (cleaning, refilling); with a sale it is customers, often several
    -- one after another at a busy moment, so it counts.
    select *, is_long and not bought as staff from bought_or_not
  ),
  people as (select * from counted where not staff),
  now_sold as (select *, extract(hour from occurred_at at time zone tz)::int as hour from sold where is_current),
  now_people as (select *, extract(hour from started_at at time zone tz)::int as hour from people where is_current)
  select jsonb_build_object(
    'cur_start', cur_start,
    'cur_end', cur_end,
    'prev_start', prev_start,
    'prev_end', prev_end,
    'timezone', tz,
    'cameras', (select coalesce(jsonb_agg(jsonb_build_object('camera_id', d.camera_id, 'method', 'zone', 'line_since', null)), '[]'::jsonb) from doors d),
    'entries', (select count(*) from now_people),
    'prev_entries', (select count(*) from people where not is_current),
    'staff', (select count(*) from counted where is_current and staff),
    'bought', (select count(*) from now_people where bought),
    'machines', (select coalesce(jsonb_agg(serial order by serial), '[]'::jsonb) from machines),
    'sales', (select count(*) from now_sold),
    'revenue', (select coalesce(sum(amount), 0) from now_sold),
    'sales_seen', (
      select count(*) from now_sold x
      where exists (select 1 from counted c where x.occurred_at between c.started_at - interval '20 seconds' and c.ended_at + interval '60 seconds')
    ),
    'stay', (
      select jsonb_build_object(
        'n', count(*),
        'p25', percentile_cont(0.25) within group (order by seconds),
        'p50', percentile_cont(0.5) within group (order by seconds),
        'p75', percentile_cont(0.75) within group (order by seconds),
        'mean', avg(seconds))
      from now_people where not is_long
    ),
    'first_event', (select at from since),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'visits', d.n) order by d.day)
      from (select to_char(started_at at time zone tz, 'YYYY-MM-DD') as day, count(*) as n from now_people group by 1) d
    ), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'visits', h.n) order by h.hour)
      from (select hour, count(*) as n from now_people group by 1) h
    ), '[]'::jsonb),
    'by_weekday', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', w.weekday, 'visits', w.n) order by w.weekday)
      from (select extract(isodow from started_at at time zone tz)::int as weekday, count(*) as n from now_people group by 1) w
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(z.hour_row order by z.hour)
      from (
        select hr.hour, jsonb_build_object(
          'hour', hr.hour,
          'visits', (select count(*) from now_people p where p.hour = hr.hour),
          'bought', (select count(*) from now_people p where p.hour = hr.hour and p.bought),
          'sales', (select count(*) from now_sold x where x.hour = hr.hour),
          'revenue', (select coalesce(sum(x.amount), 0) from now_sold x where x.hour = hr.hour),
          'top', coalesce((
            select jsonb_agg(jsonb_build_object('serial', i.serial, 'item_ref', i.item_ref, 'units', i.units) order by i.units desc, i.serial, i.item_ref)
            from (
              select x.serial, x.item_ref, count(*) as units from now_sold x where x.hour = hr.hour
              group by 1, 2 order by 3 desc, 1, 2 limit 3
            ) i
          ), '[]'::jsonb)
        ) as hour_row
        from generate_series(0, 23) as hr(hour)
        where exists (select 1 from now_people p where p.hour = hr.hour) or exists (select 1 from now_sold x where x.hour = hr.hour)
      ) z
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.ci_entrances_report(text[], integer, text, integer) from public, anon, authenticated;
grant execute on function public.ci_entrances_report(text[], integer, text, integer) to service_role;

