-- /api/invite-signup が service_role JWT で invite_tokens を参照・更新できるようにする。
-- 20260413090000 で anon/authenticated から revoke のみのため、明示 GRANT が無い環境では permission denied になる。
grant select, update on table public.invite_tokens to service_role;
