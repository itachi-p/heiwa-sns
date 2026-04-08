-- 旧 UI 用の per-user 数値閾値。閲覧フィルタは toxicity_filter_level + アプリ定数（lib/toxicity-filter-level.ts）のみ。
alter table public.users
  drop column if exists timeline_toxicity_threshold,
  drop column if exists reply_toxicity_threshold;

-- 製品上「親密度」という語は使わない。外部ツールでテーブル説明を見たときの表記用。
comment on table public.user_affinity is
  'スキ操作で更新するユーザー間の累積重み（タイムライン順の補助）。投稿ごとの人気指標は持たない。';
