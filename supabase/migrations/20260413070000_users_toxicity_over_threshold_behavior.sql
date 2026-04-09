alter table public.users
  add column if not exists toxicity_over_threshold_behavior text not null default 'hide'
  check (toxicity_over_threshold_behavior in ('hide', 'fold'));
