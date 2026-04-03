-- スキ（like）操作で更新するユーザー間の親密度。投稿ごとの集計はしない。
create table if not exists public.user_affinity (
  from_user_id uuid not null references public.users (id) on delete cascade,
  to_user_id uuid not null references public.users (id) on delete cascade,
  like_score double precision not null default 0,
  updated_at timestamptz not null default now(),
  primary key (from_user_id, to_user_id)
);

create index if not exists user_affinity_from_idx
  on public.user_affinity (from_user_id);

alter table public.user_affinity enable row level security;

-- 閲覧者は「自分から見た」行のみ読める（タイムライン用）
drop policy if exists "user_affinity_select_own_from" on public.user_affinity;
create policy "user_affinity_select_own_from"
on public.user_affinity for select
to authenticated
using (auth.uid() = from_user_id);

grant select on public.user_affinity to authenticated;

-- 双方向更新は RLS では liker が author 行を直接触れないため RPC で行う
create or replace function public.apply_user_affinity_on_like(
  p_liker uuid,
  p_author uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_liker is null or p_author is null then
    return;
  end if;
  if p_liker = p_author then
    return;
  end if;
  if auth.uid() is distinct from p_liker then
    return;
  end if;

  insert into public.user_affinity (from_user_id, to_user_id, like_score, updated_at)
  values (p_liker, p_author, 1, now())
  on conflict (from_user_id, to_user_id) do update
  set like_score = public.user_affinity.like_score * 0.9 + 1,
      updated_at = now();

  insert into public.user_affinity (from_user_id, to_user_id, like_score, updated_at)
  values (p_author, p_liker, 0.2, now())
  on conflict (from_user_id, to_user_id) do update
  set like_score = public.user_affinity.like_score * 0.9 + 0.2,
      updated_at = now();
end;
$$;

revoke all on function public.apply_user_affinity_on_like(uuid, uuid) from public;
grant execute on function public.apply_user_affinity_on_like(uuid, uuid) to authenticated;
