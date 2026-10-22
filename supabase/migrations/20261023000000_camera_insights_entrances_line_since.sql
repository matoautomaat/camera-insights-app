-- Camera Insights: a line drawn across the door takes over the count from its first crossing, not for all time.
-- Before, one crossing switched the whole camera to lines, so every day before the line was drawn fell to 0. Now the
-- door camera's person detections count until the line's first crossing, and the line from then on. first_event is
-- the moment every entrance camera counts the way it does now, so the change of method never shows as growth or a
-- drop ("new since"). Each camera also says since when it counts with its line. Only ci_*; same signature.

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

  with cams as (
    select c.camera_id,
      (select min(e.started_at) from ci_events e where e.camera_id = c.camera_id and e.kind = 'line' and 'person' = any(e.objects)) as line_since,
      (select min(e.started_at) from ci_events e where e.camera_id = c.camera_id and e.kind = 'zone' and 'person' = any(e.objects)) as zone_since
    from unnest(camera_ids) as c(camera_id)
  ),
  counted as (
    select e.camera_id, e.started_at, e.started_at >= cur_start as is_current
    from ci_events e
    join cams c on c.camera_id = e.camera_id
    where 'person' = any(e.objects)
      and (
        e.kind = 'line'
        or (
          e.kind = 'zone'
          and (c.line_since is null or e.started_at < c.line_since)
          -- Someone at the door for 10 minutes or more is staff (refilling, cleaning), not someone coming in.
          and not (e.ended_at is not null and e.ended_at - e.started_at >= interval '10 minutes')
        )
      )
      and e.started_at >= prev_start and e.started_at < cur_end
      and (e.started_at < prev_end or e.started_at >= cur_start)
  )
  select jsonb_build_object(
    'cur_start', cur_start,
    'cur_end', cur_end,
    'prev_start', prev_start,
    'prev_end', prev_end,
    'timezone', tz,
    'cameras', (select coalesce(jsonb_agg(jsonb_build_object(
        'camera_id', c.camera_id,
        'method', case when c.line_since is not null then 'line' else 'zone' end,
        'line_since', c.line_since
      )), '[]'::jsonb) from cams c),
    'entries', (select count(*) from counted where is_current),
    'prev_entries', (select count(*) from counted where not is_current),
    'first_event', (select max(coalesce(c.line_since, c.zone_since)) from cams c),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'visits', d.n) order by d.day)
      from (select to_char(started_at at time zone tz, 'YYYY-MM-DD') as day, count(*) as n from counted where is_current group by 1) d
    ), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'visits', h.n) order by h.hour)
      from (select extract(hour from started_at at time zone tz)::int as hour, count(*) as n from counted where is_current group by 1) h
    ), '[]'::jsonb),
    'by_weekday', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', w.weekday, 'visits', w.n) order by w.weekday)
      from (select extract(isodow from started_at at time zone tz)::int as weekday, count(*) as n from counted where is_current group by 1) w
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.ci_entrances_report(text[], integer, text) from public, anon, authenticated;
grant execute on function public.ci_entrances_report(text[], integer, text) to service_role;
