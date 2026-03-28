-- user_interests を廃止し、趣味・関心は users.interests（カンマ区切り・最大3語）と
-- users.interest_custom_creations_count（カスタム語を interest_tags に新規登録した回数・0〜3）に集約する。

alter table public.users
  add column if not exists interest_custom_creations_count smallint not null default 0;

alter table public.users
  drop constraint if exists users_interest_custom_creations_count_range;

alter table public.users
  add constraint users_interest_custom_creations_count_range
  check (interest_custom_creations_count between 0 and 3);

-- interest_tags 実数と整合（マイグレーション時点の真実）
update public.users u
set interest_custom_creations_count = least(
  3,
  coalesce(
    (
      select count(*)::int
      from public.interest_tags t
      where t.created_by = u.id
        and t.is_preset = false
    ),
    0
  )
);

-- 中間テーブルにだけデータがあるユーザーは、ラベル列へ寄せる
update public.users u
set interests = agg.labels
from (
  select
    ui.user_id as uid,
    string_agg(it.label, ',' order by ui.position) as labels
  from public.user_interests ui
  inner join public.interest_tags it on it.id = ui.tag_id
  group by ui.user_id
) agg
where u.id = agg.uid;

drop trigger if exists user_interests_max_three_bi on public.user_interests;

drop function if exists public.enforce_user_interests_max_three ();

drop policy if exists "user_interests_select_authenticated" on public.user_interests;

drop policy if exists "user_interests_insert_own" on public.user_interests;

drop policy if exists "user_interests_update_own" on public.user_interests;

drop policy if exists "user_interests_delete_own" on public.user_interests;

drop table if exists public.user_interests;

comment on column public.users.interests is
  '趣味・関心: 最大3語をカンマまたは読点で区切り。interest_tags の語と一致させても、未登録の語のみでも可。';

comment on column public.users.interest_custom_creations_count is
  '一覧にない語を interest_tags に新規登録した累計回数（ユーザーあたり上限3）。アプリで interest_tags 作成時に増やす。';
