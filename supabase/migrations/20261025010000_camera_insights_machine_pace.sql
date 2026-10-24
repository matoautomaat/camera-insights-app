-- Camera Insights: a warning when a machine suddenly sells far less than usual (Xin, 25-10-2026: Brood sold 17-21 a
-- day and then 3, 3; "add that warning, add to all machines"). Per terminal: approved sales in the last recent_hours,
-- and in the base_days before that, with how many of those days the terminal was already selling. Whether the drop is
-- real is decided in src/lib/alerts.ts by the rules of stats.ts. Additive, only ci_*.

create or replace function public.ci_machine_pace(serials text[], recent_hours integer default 48, base_days integer default 28)
returns jsonb
language sql
stable
set search_path = public
as $$
  with bounds as (
    select now() - make_interval(hours => recent_hours) as recent_start,
           now() - make_interval(hours => recent_hours) - make_interval(days => base_days) as base_start
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'serial', t.serial,
    'recent', (select count(*) from ci_sales s where s.serial = t.serial and s.approved and s.amount > 0 and s.occurred_at >= b.recent_start),
    'base', (select count(*) from ci_sales s where s.serial = t.serial and s.approved and s.amount > 0 and s.occurred_at >= b.base_start and s.occurred_at < b.recent_start),
    'base_days', least(base_days::numeric, greatest(0, extract(epoch from b.recent_start - coalesce(
      (select min(s.occurred_at) from ci_sales s where s.serial = t.serial and s.approved and s.amount > 0), b.recent_start)) / 86400.0)),
    'last_sale', (select max(s.occurred_at) from ci_sales s where s.serial = t.serial and s.approved and s.amount > 0)
  ) order by t.ord), '[]'::jsonb)
  from unnest(serials) with ordinality as t(serial, ord), bounds b
$$;

revoke all on function public.ci_machine_pace(text[], integer, integer) from public, anon, authenticated;
grant execute on function public.ci_machine_pace(text[], integer, integer) to service_role;
