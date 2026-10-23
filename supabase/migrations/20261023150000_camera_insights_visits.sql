-- Camera Insights: count visits, not detections (Xin, 23-10-2026: "precise count of unique person coming in", "how
-- long people stay inside on average"). Protect cuts one person into many detections: the cleaner was 13 "visitors" in
-- 20 minutes at the door camera alone. A visit now runs from the first moment any camera in the place (every camera on
-- the entrance cameras' consoles that is not hidden) sees a person, until 60 seconds without anyone in view; it counts
-- when an entrance camera saw it. A visit of 10 minutes or more is staff (cleaning, refilling) and left out. Two people
-- inside at the same moment are one visit: never matched by appearance, that would take biometrics. Its length is the
-- time inside. The door line no longer counts here: its crossings are kept (line_detail) until a line proves reliable.
-- Same signature, only ci_*.

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
        <= interval '60 seconds' then 0 else 1 end as new_visit
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
  counted as (
    select s as started_at, extract(epoch from e - s) as seconds, s >= cur_start as is_current,
      e - s >= interval '10 minutes' as staff
    from visits
    where door and s >= prev_start and s < cur_end and (s < prev_end or s >= cur_start)
  ),
  people as (select * from counted where not staff)
  select jsonb_build_object(
    'cur_start', cur_start,
    'cur_end', cur_end,
    'prev_start', prev_start,
    'prev_end', prev_end,
    'timezone', tz,
    'cameras', (select coalesce(jsonb_agg(jsonb_build_object('camera_id', d.camera_id, 'method', 'zone', 'line_since', null)), '[]'::jsonb) from doors d),
    'entries', (select count(*) from people where is_current),
    'prev_entries', (select count(*) from people where not is_current),
    'staff', (select count(*) from counted where is_current and staff),
    'stay', (
      select jsonb_build_object(
        'n', count(*),
        'p25', percentile_cont(0.25) within group (order by seconds),
        'p50', percentile_cont(0.5) within group (order by seconds),
        'p75', percentile_cont(0.75) within group (order by seconds),
        'mean', avg(seconds))
      from people where is_current
    ),
    'first_event', (
      select min(e.started_at) from ci_events e
      where e.camera_id = any(camera_ids) and e.kind = 'zone' and 'person' = any(e.objects)
    ),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'visits', d.n) order by d.day)
      from (select to_char(started_at at time zone tz, 'YYYY-MM-DD') as day, count(*) as n from people where is_current group by 1) d
    ), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'visits', h.n) order by h.hour)
      from (select extract(hour from started_at at time zone tz)::int as hour, count(*) as n from people where is_current group by 1) h
    ), '[]'::jsonb),
    'by_weekday', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', w.weekday, 'visits', w.n) order by w.weekday)
      from (select extract(isodow from started_at at time zone tz)::int as weekday, count(*) as n from people where is_current group by 1) w
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.ci_entrances_report(text[], integer, text) from public, anon, authenticated;
grant execute on function public.ci_entrances_report(text[], integer, text) to service_role;
