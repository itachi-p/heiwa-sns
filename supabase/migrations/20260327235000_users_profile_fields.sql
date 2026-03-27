alter table public.users
  add column if not exists bio text,
  add column if not exists interests text;
