-- 5指標はDBに保持しない方針。誤って追加された列があれば削除（max のみ posts / post_replies に保持）。
alter table public.posts
  drop column if exists moderation_scores_first,
  drop column if exists moderation_scores_finalize;

alter table public.post_replies
  drop column if exists moderation_scores_first,
  drop column if exists moderation_scores_finalize;
