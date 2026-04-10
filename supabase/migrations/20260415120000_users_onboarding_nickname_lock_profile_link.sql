-- 招待オンボーディング（Google 等はコード紐付け完了まで false のまま）
alter table public.users
  add column if not exists invite_onboarding_completed boolean not null default false;

-- 既存行はすべて完了済みとみなす
update public.users set invite_onboarding_completed = true;

-- ニックネーム変更ロック（初回確定後 true）
alter table public.users
  add column if not exists nickname_locked boolean not null default false;

update public.users
set nickname_locked = true
where nickname is not null and trim(nickname) <> '';

-- 貸与アカウント等・パスワード未変更のうちはニック再設定を許す
update public.users
set nickname_locked = false
where must_change_password = true;

-- プロフィール外部リンク（https のみ・検証はアプリ側）
alter table public.users
  add column if not exists profile_external_url text;

-- アクティビティ「未読」比較用（任意）
alter table public.users
  add column if not exists activity_last_seen_at timestamptz;

comment on column public.users.invite_onboarding_completed is '招待コード紐付け完了（メール新規登録 API か invite-bind で true）';
comment on column public.users.nickname_locked is 'true のときニックネーム変更不可（初回確定後）';
comment on column public.users.profile_external_url is 'プロフィール用外部リンク（https のみ）';
comment on column public.users.activity_last_seen_at is 'アクティビティを最後に開いた時刻';
