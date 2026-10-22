-- Camera Insights: what Protect says about a line crossing itself (which way, which line), to count only the people
-- walking in. Only key names and short plain values about direction or the line (lineDetail in protect-events.ts);
-- never a picture, a description or anything about the person. Additive.

alter table public.ci_events add column if not exists line_detail jsonb;
