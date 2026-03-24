-- 投稿削除を投稿者本人のみに許可
create policy "posts_delete_authenticated"
on public.posts for delete
to authenticated
using (auth.uid() = user_id);

grant delete on public.posts to authenticated;
