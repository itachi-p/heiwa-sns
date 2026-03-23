-- ニックネーム重複を防ぐ（大文字小文字は同一視）
create unique index if not exists users_nickname_unique_ci
  on public.users (lower(nickname))
  where nickname is not null;
