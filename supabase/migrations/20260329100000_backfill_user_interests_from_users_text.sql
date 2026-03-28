-- 旧 users.interests から user_interests / interest_tags へ一度移す（中間ステップ）。
-- 最終形は 20260329120000 で user_interests 廃止・users.interests へ再集約。
-- すでに user_interests に行があるユーザーはスキップ（冪等）。
-- 移行できたユーザーは interests を NULL にし、アプリの正本を user_interests のみに揃える。

do $bf$
declare
  r record;
  raw text;
  tok text;
  tid uuid;
  pos int;
  arr jsonb;
  tokens text[];
  i int;
  json_done boolean;
begin
  for r in
    select u.id, u.interests
    from public.users u
    where u.interests is not null
      and btrim(u.interests) <> ''
      and not exists (
        select 1 from public.user_interests ui where ui.user_id = u.id
      )
  loop
    raw := btrim(r.interests);
    pos := 1;
    json_done := false;

    if left(raw, 1) = '[' then
      begin
        arr := raw::jsonb;
        if jsonb_typeof(arr) = 'array' then
          json_done := true;
          for i in 0..coalesce(jsonb_array_length(arr), 0) - 1 loop
            exit when pos > 3;
            tok := btrim(arr ->> i);
            continue when tok = '' or tok is null;

            select it.id into tid from public.interest_tags it
            where lower(trim(it.label)) = lower(trim(tok));
            if tid is null then
              begin
                insert into public.interest_tags (label, is_preset, created_by)
                values (tok, false, r.id)
                returning id into tid;
              exception
                when unique_violation then
                  select it.id into tid from public.interest_tags it
                  where lower(trim(it.label)) = lower(trim(tok));
              end;
            end if;

            if not exists (
              select 1 from public.user_interests x
              where x.user_id = r.id and x.tag_id = tid
            ) then
              insert into public.user_interests (user_id, tag_id, position)
              values (r.id, tid, pos);
              pos := pos + 1;
            end if;
          end loop;
        end if;
      exception
        when others then
          json_done := false;
      end;
    end if;

    if not json_done then
      tokens := regexp_split_to_array(raw, ',|、');
      for i in 1..coalesce(array_length(tokens, 1), 0) loop
        exit when pos > 3;
        tok := btrim(tokens[i]);
        continue when tok = '';

        select it.id into tid from public.interest_tags it
        where lower(trim(it.label)) = lower(trim(tok));
        if tid is null then
          begin
            insert into public.interest_tags (label, is_preset, created_by)
            values (tok, false, r.id)
            returning id into tid;
          exception
            when unique_violation then
              select it.id into tid from public.interest_tags it
              where lower(trim(it.label)) = lower(trim(tok));
          end;
        end if;

        if not exists (
          select 1 from public.user_interests x
          where x.user_id = r.id and x.tag_id = tid
        ) then
          insert into public.user_interests (user_id, tag_id, position)
          values (r.id, tid, pos);
          pos := pos + 1;
        end if;
      end loop;
    end if;

    if exists (select 1 from public.user_interests where user_id = r.id) then
      update public.users set interests = null where id = r.id;
    end if;
  end loop;
end
$bf$;

comment on column public.users.interests is
  '廃止: 趣味・関心は user_interests / interest_tags を使用。NULL 推奨。';
