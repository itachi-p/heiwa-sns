-- 趣味・関心の選択は user_interests（user_id + interest_tags.id + position）のみとする。
-- users.interests テキスト列は廃止（手入力のカンマ区切りは使わない）。再設定はアプリから。

alter table public.users drop column if exists interests;

-- 20260329120000 で user_interests は既に削除済み。PostgreSQL では
-- DROP TRIGGER ... ON public.user_interests はテーブルが無いとエラーになる（IF EXISTS はトリガー名のみ）。
drop table if exists public.user_interests cascade;

drop function if exists public.enforce_user_interests_max_three ();

create table public.user_interests (
  user_id uuid not null references public.users (id) on delete cascade,
  tag_id uuid not null references public.interest_tags (id) on delete cascade,
  position smallint not null,
  primary key (user_id, tag_id),
  constraint user_interests_position_range check (position between 1 and 3),
  constraint user_interests_unique_pos unique (user_id, position)
);

create or replace function public.enforce_user_interests_max_three ()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*)::int from public.user_interests where user_id = new.user_id) >= 3 then
      raise exception 'user_interests: 3件までです';
    end if;
  end if;
  return new;
end;
$$;

create trigger user_interests_max_three_bi
before insert on public.user_interests
for each row execute function public.enforce_user_interests_max_three ();

alter table public.user_interests enable row level security;

create policy "user_interests_select_authenticated"
on public.user_interests for select
to authenticated
using (true);

create policy "user_interests_insert_own"
on public.user_interests for insert
to authenticated
with check (user_id = auth.uid());

create policy "user_interests_update_own"
on public.user_interests for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "user_interests_delete_own"
on public.user_interests for delete
to authenticated
using (user_id = auth.uid());

grant select, insert, update, delete on public.user_interests to authenticated;

comment on column public.users.interest_custom_creations_count is
  '一覧にない語を interest_tags に新規登録した累計回数（0〜3）。選択中タグは user_interests のみ。';
