-- Camera Insights: which Payter account (1 = PAYTER_*, 2 = PAYTER_2_*, …) a terminal was read from. Additive.
alter table public.ci_terminals add column if not exists account smallint not null default 1;
