-- /api/invite-signup・/api/invite-bind が service_role で public.users を参照・更新できるようにする。
-- invite_tokens と同様、JWT が service_role でもテーブル権限が無いと permission denied になる。
grant select, update on table public.users to service_role;
