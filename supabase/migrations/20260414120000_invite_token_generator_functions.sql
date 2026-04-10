-- 既存の public.invite_tokens（20260413090000）向けの生成ヘルパー。
-- テーブル定義は変更しない（アプリは used_by_user_id / used_at 等を使用）。

create or replace function public.generate_invite_token()
returns text
language plpgsql
volatile
security invoker
set search_path = public
as $func$
declare
  chars constant text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  result text := '';
  i int;
  pos int;
begin
  for i in 1..6 loop
    pos := floor(random() * length(chars) + 1)::int;
    result := result || substr(chars, pos, 1);
  end loop;
  return result;
end;
$func$;

create or replace function public.create_invite_tokens(p_count int)
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $func$
declare
  i int;
  new_token text;
  attempts int;
  max_attempts constant int := 1000;
begin
  if p_count is null or p_count < 1 then
    raise exception 'create_invite_tokens: p_count must be >= 1';
  end if;

  for i in 1..p_count loop
    attempts := 0;
    loop
      attempts := attempts + 1;
      if attempts > max_attempts then
        raise exception 'create_invite_tokens: could not generate unique token';
      end if;
      new_token := public.generate_invite_token();
      exit when not exists (
        select 1 from public.invite_tokens t where t.token = new_token
      );
    end loop;
    insert into public.invite_tokens (token) values (new_token);
  end loop;
end;
$func$;

comment on function public.generate_invite_token() is
  '6文字の英小文字+数字のランダム文字列（invite_tokens.token 用）';
comment on function public.create_invite_tokens(int) is
  '未使用の招待トークンを p_count 件 insert する';

revoke all on function public.generate_invite_token() from public;
revoke all on function public.create_invite_tokens(int) from public;
grant execute on function public.generate_invite_token() to service_role;
grant execute on function public.create_invite_tokens(int) to service_role;
