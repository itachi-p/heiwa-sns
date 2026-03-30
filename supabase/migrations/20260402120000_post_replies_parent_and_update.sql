-- 返信のスレッド（特定の返信への返信）
alter table public.post_replies
  add column parent_reply_id bigint null
  references public.post_replies (id) on delete cascade;

create index post_replies_parent_idx
  on public.post_replies (parent_reply_id)
  where parent_reply_id is not null;

-- 投稿と同様、本人のみ・投稿から15分以内に content を更新可
grant update on public.post_replies to authenticated;

create policy "post_replies_update_own_within_15min"
on public.post_replies for update
to authenticated
using (
  auth.uid() = user_id
  and created_at >= (now() - interval '15 minutes')
)
with check (auth.uid() = user_id);
