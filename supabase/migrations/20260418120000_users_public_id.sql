-- URL 用の公開 ID（一意・初回のみ設定、変更不可はアプリ側）
alter table public.users
  add column if not exists public_id text;

create unique index if not exists users_public_id_unique
  on public.users (public_id)
  where public_id is not null;

comment on column public.users.public_id is
  '公開プロフィール URL 用（例 /@handle の handle）。英小文字・数字・._- のみ。';
