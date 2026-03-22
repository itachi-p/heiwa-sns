-- ニックネーム（1〜20文字、改行不可、trim 済みのみ。null は未設定）
alter table public.users
  add column if not exists nickname text;

alter table public.users
  drop constraint if exists users_nickname_valid;

alter table public.users
  add constraint users_nickname_valid check (
    nickname is null
    or (
      char_length(nickname) between 1 and 20
      and nickname = btrim(nickname)
      and position(E'\n' in nickname) = 0
      and position(E'\r' in nickname) = 0
    )
  );

-- ログインユーザー同士でニックネームを参照できるように（一覧で author を表示するため）
-- 既存の「自分のみ SELECT」と併せると OR になるが、全件読み取りで十分なら単純化
drop policy if exists "users_select_own" on public.users;

create policy "users_select_authenticated"
on public.users for select
to authenticated
using (true);
