-- Camera Insights: how many people one detection held, as Protect says it (Xin, 23-10-2026: "two or more people coming
-- in at once"). Protect makes one detection per camera while anyone is in view, so two people side by side are one
-- detection. Kept: the number of person pictures Protect lists, all its pictures, its sub-events and its own count,
-- numbers only (peopleHint in protect-events.ts); never a picture, id or description. Additive.

alter table public.ci_events add column if not exists people jsonb;
