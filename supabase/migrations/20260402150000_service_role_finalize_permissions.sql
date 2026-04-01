-- finalize-pending-edits API が service_role で posts / post_replies を確定更新できるようにする
grant usage on schema public to service_role;
grant select, update on table public.posts to service_role;
grant select, update on table public.post_replies to service_role;
