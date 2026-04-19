-- nickname_locked カラム drop（cleanup_audit 章 7）
-- 仕様変更でニックネームは任意・変更可となり、アプリコードからは未参照のデッド状態。
-- 旧マイグレーション 20260415120000_users_onboarding_nickname_lock_profile_link.sql で追加。
alter table public.users
  drop column if exists nickname_locked;
