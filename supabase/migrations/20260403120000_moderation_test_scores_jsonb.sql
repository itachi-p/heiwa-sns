-- テスト用: 初回・編集確定時の5指標スナップショット（{ "first": {...}, "final": {...} }）
alter table public.posts
  add column if not exists moderation_test_scores jsonb null;

alter table public.post_replies
  add column if not exists moderation_test_scores jsonb null;
