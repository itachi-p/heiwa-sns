-- 自分の返信のみ削除可

create policy "post_replies_delete_own"
on public.post_replies for delete
to authenticated
using (user_id = auth.uid());

grant delete on public.post_replies to authenticated;
