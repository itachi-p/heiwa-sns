-- public_id の defense-in-depth（cleanup_audit 章 4）
-- アプリ層で形式検証 + 初回限定を行っているが、authenticated が Supabase JS で
-- 直接 update({ public_id: ... }) するとバイパス可能。DB 層で両方を強制する。

-- 1) 形式 CHECK: lib/public-id.ts の PUBLIC_ID_RE と一致させる。
--    既存行はすべて API 経由（normalizePublicId + isValidPublicIdFormat を通過）なので非破壊。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_public_id_format'
  ) then
    alter table public.users
      add constraint users_public_id_format
      check (public_id is null or public_id ~ '^[a-z0-9._-]{5,20}$');
  end if;
end $$;

-- 2) 不変性トリガー: 一度 NOT NULL になった public_id の UPDATE を蹴る。
--    INSERT や NULL→値 の初回設定は許可（OLD が無いため）。
create or replace function public.prevent_public_id_change()
returns trigger
language plpgsql
as $$
begin
  if old.public_id is not null and new.public_id is distinct from old.public_id then
    raise exception 'public_id is immutable once set';
  end if;
  return new;
end;
$$;

drop trigger if exists users_public_id_immutable on public.users;
create trigger users_public_id_immutable
  before update on public.users
  for each row
  execute function public.prevent_public_id_change();

comment on function public.prevent_public_id_change() is
  'public_id は一度 NOT NULL になったら変更不可。アプリ層の初回限定制約の DB 層ミラー。';
