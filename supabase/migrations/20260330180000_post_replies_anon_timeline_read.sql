-- 未ログイン閲覧: posts 一覧と user 表示用の最小列のみ anon に公開
-- 返信 post_replies: 全員が読める・ログインユーザーのみ投稿

grant usage on schema public to anon;

grant select on public.posts to anon;

create policy "posts_select_anon"
on public.posts for select
to anon
using (true);

grant select (id, nickname, avatar_url) on public.users to anon;

create policy "users_select_anon_public"
on public.users for select
to anon
using (true);

create table public.post_replies (
  id bigint generated always as identity primary key,
  post_id integer not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  constraint post_replies_content_len check (
    char_length(trim(content)) >= 1
    and char_length(content) <= 2000
  )
);

create index post_replies_post_created_idx
  on public.post_replies (post_id, created_at);

alter table public.post_replies enable row level security;

create policy "post_replies_select_anon"
on public.post_replies for select
to anon
using (true);

create policy "post_replies_select_authenticated"
on public.post_replies for select
to authenticated
using (true);

create policy "post_replies_insert_own"
on public.post_replies for insert
to authenticated
with check (user_id = auth.uid());

grant select on public.post_replies to anon, authenticated;
grant insert on public.post_replies to authenticated;
