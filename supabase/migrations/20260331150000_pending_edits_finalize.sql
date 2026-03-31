-- 15分編集窓のあいだに保存された下書き（即時反映しない）
alter table public.posts
  add column if not exists pending_content text null;

alter table public.post_replies
  add column if not exists pending_content text null;
