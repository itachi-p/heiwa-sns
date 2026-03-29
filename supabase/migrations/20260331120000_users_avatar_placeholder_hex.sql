-- 画像未設定時の丸アイコン用背景色（ニックネーム登録時にランダムで1回設定）

alter table public.users
  add column if not exists avatar_placeholder_hex text;

comment on column public.users.avatar_placeholder_hex is
  'avatar_url が無いときのプレースホルダー丸の背景色 #RRGGBB';

grant select (avatar_placeholder_hex) on table public.users to anon;
