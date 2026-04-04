# 実装参照（アルゴリズム・データの真）

**読者**: 開発者・Cursor。**ユーザー向け説明**は [`../INVITE_DEEP_DIVE.md`](../INVITE_DEEP_DIVE.md) から辿る。

この文書は **現行コード** に合わせて維持する。数式や閾値を変えたら **同じ変更で本ファイル**（必要なら [`../PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md`](../PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md)）も更新する。

---

## 1. タイムライン表示順（トップ `app/page.tsx`）

処理順: **毒性フィルタで除外** → **並び替え**（`lib/timeline-sort.ts` の `sortTimelinePosts`）。

### 1.1 毒性による除外（他人投稿のみ）

- 閲覧者の `toxicity_filter_level` → 閾値は `lib/toxicity-filter-level.ts` の `TOXICITY_THRESHOLDS`。
- 比較対象は `moderation_max_score` に **ノイズフロア**（`TOXICITY_SCORE_NOISE_FLOOR = 0.1`）適用後（`effectiveScoreForViewerToxicityFilter`）。
- **`effectiveScore > thresholdForLevel(level)`** ならタイムラインから除外。**自分の投稿は常に残す**。

### 1.2 並び（新しさ主軸・スキはタイブレークのみ）

`lib/timeline-sort.ts` の `sortTimelinePosts`。

**第1キー**: `created_at` のエポック ms **降順**。**1ms でも新しければ、スキの二次スコアより常に上**（同一 DB タイムスタンプ内だけスキ等で順序が動く）。

**第2キー（`created_at` が同一 ms のときのみ）** — 二次スコア（大きいほど上）:

```
affinity = min(0.08, log1p(like_score) * 0.012)
toxicity_soft = toxicitySortSoftFactor(relation_multiplier)   // reply_toxic_events 由来 0.5〜0.8 → 0.97〜1.0 に圧縮
own_boost = (投稿者 == 閲覧者) ? 0.1 : 0

secondary = affinity * toxicity_soft + own_boost
```

- `like_score`: 閲覧者 `from_user_id` → 投稿者 `to_user_id` の **`user_affinity.like_score`**（無ければ 0）。RPC `apply_user_affinity_on_like` で更新。
- `relation_multiplier`: 過去 14 日・閲覧者が target の `reply_toxic_events` で、投稿者が actor の行の **`min(1, 1 - max_score)` を 0.5〜0.8 にクランプ**した値の **作者ごとの最小**（`app/page.tsx` の `RELATION_PENALTY_WINDOW_DAYS` と一致させること）。

**第3キー**: `id` 降順（安定化）。

**5 指標の開発用表示**: **正は DB** の `moderation_dev_scores`（`{ first, second }`）。一覧取得時に `mergeDevScoresById` で state に載せる。localStorage / IndexedDB はオフライン・別タブ用のキャッシュ。IDB 復元前は **空 state を IDB に書かない**（`scoresPersistenceEnabled`）。2 行目は編集窓経過後に `/api/persist-moderation-dev-scores`（service role）または pending 確定の `finalize-pending-edits-core` で保存。

---

## 2. 毒性・UI メッセージ（投稿者向け注意など）

- 投稿・返信直後の投稿者向け注意: `overallMax >= HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD`。値は **`TOXICITY_THRESHOLDS.normal`（0.7）と同一**（`lib/toxicity-filter-level.ts`）。文言・表示形式は `lib/visibility-notice.ts` および `app/page.tsx` / `app/home/page.tsx` の既存定数のまま。
- 閲覧側: `off`（1.0）以外では `effectiveScore > thresholdForLevel(level)` で他人投稿をタイムラインから除外、リプは同閾値で折りたたみ（`components/reply-thread.tsx`）。**`off` のときのみ 0.7 超もそのまま表示**される。
- 返信折りたたみ等の UI 文言・条件は `app/page.tsx` / `app/home/page.tsx` を参照（変更時は本書に一行追記可）。

---

## 3. スキ（いいね）とデータ

- **投稿にいいね数は表示しない**（集計カラムも持たない方針）。
- `likes` テーブル: `user_id`, `post_id`, `created_at`（重複防止）。
- タイムライン優先度に効くのは **`user_affinity.like_score`**（ユーザー間の減衰付き累積）。詳細は `supabase/migrations/` 内 RPC 定義。

---

## 4. モデレーションスコアの保存方針

- **閲覧フィルタに使うのは `moderation_max_score`（0〜1）のみ**（投稿・返信）。
- **開発用 5 指標**は `moderation_dev_scores`（jsonb、任意）に `{ first, second }` で保存し、**全クライアントで共有**。フィルタ・公開ランキングには使わない。補助キャッシュは localStorage / IndexedDB（[`../PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md`](../PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md) 参照）。

---

## 5. 関連ソース一覧（変更時チェック）

| 領域 | 主なファイル |
|------|----------------|
| タイムライン取得・フィルタ・呼び出し | `app/page.tsx`（`fetchPosts`） |
| 並び純関数 | `lib/timeline-sort.ts` |
| 毒性閾値・ノイズフロア | `lib/toxicity-filter-level.ts` |
| 匿名時の閾値 | `lib/timeline-threshold.ts` |
| 5 指標（DB + キャッシュ） | `lib/moderation-dev-scores-db.ts`, `app/api/persist-moderation-dev-scores/route.ts`, `lib/persist-moderation-dev-scores-client.ts`, `lib/moderation-scores-indexeddb.ts`, `lib/pending-second-moderation.ts`, `lib/second-moderation-timing.ts` |
| E2E | `playwright.config.ts`, `e2e/` |
| スキーマ意図 | [`../schema.md`](../schema.md), `supabase/migrations/` |
