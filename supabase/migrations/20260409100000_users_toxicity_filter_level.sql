-- 攻撃性フィルタ（厳しめ〜オフ）。閾値はアプリ定数 TOXICITY_THRESHOLDS で解釈する。
alter table public.users
  add column if not exists toxicity_filter_level text not null default 'normal'
  check (toxicity_filter_level in ('strict', 'soft', 'normal', 'off'));
