-- 開発用5指標（1行目・2行目）を全クライアントで共有するため JSON で保持。フィルタ判定は moderation_max_score のみ。
alter table public.posts
  add column if not exists moderation_dev_scores jsonb null;

alter table public.post_replies
  add column if not exists moderation_dev_scores jsonb null;

comment on column public.posts.moderation_dev_scores is
  'Optional { "first": {ATTR: score}, "second": {...} } from Perspective; dev display only.';

comment on column public.post_replies.moderation_dev_scores is
  'Optional { "first": {ATTR: score}, "second": {...} } from Perspective; dev display only.';
