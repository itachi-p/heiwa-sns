-- Google OAuth 後のプロフィール用 users テーブル（auth.users と紐付け）
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

drop policy if exists "users_select_own" on public.users;
drop policy if exists "users_insert_own" on public.users;
drop policy if exists "users_update_own" on public.users;

create policy "users_select_own"
on public.users for select
to authenticated
using (auth.uid() = id);

create policy "users_insert_own"
on public.users for insert
to authenticated
with check (auth.uid() = id);

create policy "users_update_own"
on public.users for update
to authenticated
using (auth.uid() = id);

grant select, insert, update on public.users to authenticated;

-- 初回サインアップ時に public.users に自動登録
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- posts / likes: 匿名キーではなくログインユーザー（JWT）で操作する
drop policy if exists "posts_anon_select" on public.posts;
drop policy if exists "posts_anon_insert" on public.posts;
drop policy if exists "likes_anon_select" on public.likes;
drop policy if exists "likes_anon_insert" on public.likes;
drop policy if exists "likes_anon_update" on public.likes;
drop policy if exists "likes_anon_delete" on public.likes;

create policy "posts_select_authenticated"
on public.posts for select
to authenticated
using (true);

create policy "posts_insert_authenticated"
on public.posts for insert
to authenticated
with check (auth.uid() = user_id);

create policy "likes_select_authenticated"
on public.likes for select
to authenticated
using (true);

create policy "likes_insert_authenticated"
on public.likes for insert
to authenticated
with check (auth.uid() = user_id);

create policy "likes_update_authenticated"
on public.likes for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "likes_delete_authenticated"
on public.likes for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, update on public.posts to authenticated;
grant select, insert, update, delete on public.likes to authenticated;
