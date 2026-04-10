-- 先行招待・貸与アカウント用（既存行はすべて false / NULL のまま）
alter table public.users
  add column if not exists is_invite_user boolean not null default false,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists invite_label text;

-- 非 NULL の invite_label のみ一意（NULL は複数可）
create unique index if not exists users_invite_label_unique
  on public.users (invite_label)
  where invite_label is not null;
