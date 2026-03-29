-- 投稿者本人のみ、投稿から15分以内に content を更新可能

create policy "posts_update_own_within_15min"
on public.posts for update
to authenticated
using (
  auth.uid() = user_id
  and created_at >= (now() - interval '15 minutes')
)
with check (
  auth.uid() = user_id
);
