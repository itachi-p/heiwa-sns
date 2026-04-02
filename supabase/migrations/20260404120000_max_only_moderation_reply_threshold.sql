-- 5指標 JSON は保持しない（画面用はクライアントのみ）。max のみ DB に残す。
alter table public.posts
  drop column if exists moderation_test_scores;

alter table public.post_replies
  drop column if exists moderation_test_scores;

alter table public.post_replies
  add column if not exists moderation_max_score real not null default 0
  check (moderation_max_score >= 0 and moderation_max_score <= 1);

-- リプ欄の閲覧しきい値（既定はタイムライン 0.7 より厳しめの 0.5）
alter table public.users
  add column if not exists reply_toxicity_threshold real not null default 0.5
  check (reply_toxicity_threshold >= 0.1 and reply_toxicity_threshold <= 0.7);

-- 返信の高スコアもイベント記録できるように上限を緩める（旧: < 0.5 固定）
alter table public.reply_toxic_events
  drop constraint if exists reply_toxic_events_max_score_check;

alter table public.reply_toxic_events
  add constraint reply_toxic_events_max_score_check
  check (max_score > 0.2 and max_score <= 1);
