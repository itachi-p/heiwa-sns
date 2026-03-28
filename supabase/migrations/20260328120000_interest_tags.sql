-- 共有の interest_tags（プリセット＋カスタム語のマスタ）と user_interests（選択は tag_id のみ）
-- users に趣味テキスト列は置かない（20260329140000 で interests 列を削除）

create table public.interest_tags (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  is_preset boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint interest_tags_label_len check (
    char_length(trim(label)) >= 1
    and char_length(label) <= 24
  ),
  constraint interest_tags_preset_creator check (
    (is_preset = true and created_by is null)
    or (is_preset = false)
  )
);

create unique index interest_tags_label_normalized_unique
  on public.interest_tags (lower(trim(label)));

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

-- ユーザーが「一覧にない語」として interest_tags に新規INSERTできる回数（上限3）
create or replace function public.enforce_interest_tags_custom_max_three ()
returns trigger
language plpgsql
as $$
begin
  if new.is_preset then
    return new;
  end if;
  if new.created_by is null then
    raise exception 'custom tag requires created_by';
  end if;
  if (
    select count(*)::int
    from public.interest_tags
    where created_by = new.created_by
      and is_preset = false
  ) >= 3 then
    raise exception 'interest_tags: 新規登録できる語は3つまでです';
  end if;
  return new;
end;
$$;

create trigger interest_tags_custom_max_three_bi
before insert on public.interest_tags
for each row execute function public.enforce_interest_tags_custom_max_three ();

-- 正規化ラベルで既存タグIDを引く（クライアントから RPC）
create or replace function public.interest_tag_id_by_normalized_label (p_label text)
returns uuid
language sql
stable
set search_path = public
as $$
  select id
  from public.interest_tags
  where lower(trim(label)) = lower(trim(p_label))
  limit 1;
$$;

grant execute on function public.interest_tag_id_by_normalized_label (text) to authenticated;

alter table public.interest_tags enable row level security;
alter table public.user_interests enable row level security;

create policy "interest_tags_select_authenticated"
on public.interest_tags for select
to authenticated
using (true);

create policy "interest_tags_insert_custom_own"
on public.interest_tags for insert
to authenticated
with check (
  is_preset = false
  and created_by = auth.uid()
);

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

grant select on public.interest_tags to authenticated;
grant insert on public.interest_tags to authenticated;
grant select, insert, update, delete on public.user_interests to authenticated;

-- プリセット（全員共有・created_by NULL）
insert into public.interest_tags (label, is_preset, created_by)
values
  ('マンガ', true, null),
  ('アニメ', true, null),
  ('映画', true, null),
  ('動画視聴', true, null),
  ('音楽鑑賞', true, null),
  ('ライブ・フェス', true, null),
  ('お笑い・演芸', true, null),
  ('ゲーム', true, null),
  ('ボードゲーム', true, null),
  ('読書', true, null),
  ('アウトドア', true, null),
  ('スポーツ', true, null),
  ('フィットネス', true, null),
  ('料理', true, null),
  ('カフェ', true, null),
  ('旅行', true, null),
  ('温泉', true, null),
  ('動物・ペット', true, null),
  ('植物・園芸', true, null),
  ('写真', true, null),
  ('イラスト・デザイン', true, null),
  ('プログラミング', true, null),
  ('学び・教養', true, null),
  ('美術・博物館', true, null),
  ('投資', true, null);
