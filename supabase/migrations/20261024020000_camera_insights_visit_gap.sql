-- Camera Insights: a visit ends after 90 seconds without anyone in view, not 60. On 23-10-2026 one person wandering
-- around from 17:34 to 17:51 (Xin) was out of every camera's view for 82 seconds and counted twice. With 90 seconds the
-- fourteen single visits Xin checked that day stay fourteen; over six days 8% fewer visits. Same signature, only ci_*.

create or replace function public.ci_entrances_report(camera_ids text[], period_days integer, tz text default 'Europe/Brussels')
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

revoke all on function public.ci_entrances_report(text[], integer, text) from public, anon, authenticated;
grant execute on function public.ci_entrances_report(text[], integer, text) to service_role;
