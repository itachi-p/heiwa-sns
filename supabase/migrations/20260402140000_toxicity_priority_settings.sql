-- 投稿の攻撃性スコア保持（閲覧時フィルタ/優先度用）
alter table public.posts
  add column if not exists moderation_max_score real not null default 0
  check (moderation_max_score >= 0 and moderation_max_score <= 1);

-- 各ユーザーの閲覧側しきい値（0.1〜0.7）
alter table public.users
  add column if not exists timeline_toxicity_threshold real not null default 0.7
  check (timeline_toxicity_threshold >= 0.1 and timeline_toxicity_threshold <= 0.7);

-- 返信で生じた対ユーザー攻撃性イベント（表示優先度の減衰材料）
create table if not exists public.reply_toxic_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references public.users (id) on delete cascade,
  target_user_id uuid not null references public.users (id) on delete cascade,
  post_id integer not null references public.posts (id) on delete cascade,
  reply_id bigint not null references public.post_replies (id) on delete cascade,
  max_score real not null check (max_score > 0.2 and max_score < 0.5),
  created_at timestamptz not null default now(),
  check (actor_user_id <> target_user_id)
);

create index if not exists reply_toxic_events_target_idx
  on public.reply_toxic_events (target_user_id, created_at desc);

alter table public.reply_toxic_events enable row level security;

drop policy if exists "reply_toxic_events_insert_actor" on public.reply_toxic_events;
create policy "reply_toxic_events_insert_actor"
on public.reply_toxic_events for insert
to authenticated
with check (auth.uid() = actor_user_id);

drop policy if exists "reply_toxic_events_select_target" on public.reply_toxic_events;
create policy "reply_toxic_events_select_target"
on public.reply_toxic_events for select
to authenticated
using (auth.uid() = target_user_id);

grant insert, select on public.reply_toxic_events to authenticated;
