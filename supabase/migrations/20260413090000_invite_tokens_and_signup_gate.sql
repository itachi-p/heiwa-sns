create table if not exists public.invite_tokens (
  id bigint generated always as identity primary key,
  token text not null unique,
  is_used boolean not null default false,
  used_at timestamptz,
  used_by_user_id uuid,
  used_by_email text,
  note text,
  created_at timestamptz not null default now()
);

revoke all on table public.invite_tokens from anon, authenticated;
