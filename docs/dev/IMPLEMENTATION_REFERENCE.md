# 実装参照（アルゴリズム・データの真）

**読者**: 開発者・Cursor。**ユーザー向け説明**は [`../INVITE_DEEP_DIVE.md`](../INVITE_DEEP_DIVE.md) から辿る。

この文書は **現行コード** に合わせて維持する。数式や閾値を変えたら **同じ変更で本ファイル**（必要なら [`../PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md`](../PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md)）も更新する。

---

## 1. タイムライン表示順（トップ `app/page.tsx`）

処理順: **毒性フィルタで除外** → **並び替え**（`lib/timeline-sort.ts` の `sortTimelinePosts`）。

### 1.1 毒性による除外（他人投稿のみ）

- 閲覧者の `toxicity_filter_level` → 閾値は `lib/toxicity-filter-level.ts` の `TOXICITY_THRESHOLDS`（`strict` 0.3 / `soft` 0.5 / `normal` 0.7 / `off` 1.0）。
- 比較対象は `moderation_max_score`（DB・投稿ごとに固定）を **`effectiveScoreForViewerToxicityFilter` で閲覧用に変換した値**（ノイズフロア `TOXICITY_SCORE_NOISE_FLOOR`、既定 0.2）。保存値そのものは変えない。
- **`effectiveScore > thresholdForLevel(level)`** ならタイムラインから除外。**自分の投稿は常に残す**。

### 1.2 並び（仮想時刻: 新しさ + スキ − 投稿の攻撃性）

`lib/timeline-sort.ts` の `sortTimelinePosts`。**仮想時刻 `virtualSortMs` を降順**（大きいほど上）。

```
virtualSortMs = created_ms
  + affinityTimeBoostMs(like_score, relation_multiplier)   // 0 〜 TIMELINE_AFFINITY_MAX_BOOST_MS（既定 3 分相当）
  + (投稿者 == 閲覧者 ? TIMELINE_OWN_POST_BOOST_MS : 0)   // 既定 1 分相当
  - moderationTimePenaltyMs(moderation_max_score, 自分投稿)   // 他人のみ。effectiveScore × TIMELINE_TOXICITY_MAX_PENALTY_MS（既定 5 分相当）
```

- `like_score` / `relation_multiplier` の定義は従来どおり（`user_affinity` と `reply_toxic_events`）。`affinitySortContribution × toxicitySortSoftFactor` を **0〜0.08 の次元**から **`affinityTimeBoostMs` に線形換算**（飽和は対数のまま）。
- 投稿の攻撃性は **`effectiveScoreForViewerToxicityFilter(moderation_max_score)`**（閲覧フィルタと同じ変換）。**見えている他人投稿**でもスコアが高いほど順位だけ沈む（非表示にならない閾値付近でも差が出る）。
- **十分に時間が離れた投稿同士**では新しい方が上になりやすい（ブースト／ペナルティは ms 上限でキャップ）。**同一仮想時刻**のタイブレークは `id` 降順。

定数: `TIMELINE_AFFINITY_MAX_BOOST_MS`, `TIMELINE_TOXICITY_MAX_PENALTY_MS`, `TIMELINE_OWN_POST_BOOST_MS`（`lib/timeline-sort.ts`）。

**5 指標の開発用表示**: **正は DB** の `moderation_dev_scores`（`{ first, second }`）。一覧取得時に `mergeDevScoresById` で state に載せる。localStorage / IndexedDB はオフライン・別タブ用のキャッシュ。IDB 復元前は **空 state を IDB に書かない**（`scoresPersistenceEnabled`）。2 行目は編集窓経過後に `/api/persist-moderation-dev-scores`（service role）または pending 確定の `finalize-pending-edits-core` で保存。

---

## 2. 毒性・UI メッセージ（投稿者向け注意など）

- 投稿・返信直後の投稿者向け注意: `overallMax >= HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD`。値は **`TOXICITY_THRESHOLDS.normal`（標準・0.7）と同一**（`lib/toxicity-filter-level.ts`）。文言・表示形式は `lib/visibility-notice.ts` および `app/page.tsx` / `app/home/page.tsx` の既存定数のまま。
- 閲覧側: `off`（1.0）以外では `effectiveScore > thresholdForLevel(level)` で他人投稿をタイムラインから除外。**リプ折りたたみ**（`components/reply-thread.tsx`）は **現状も同じ** `thresholdForLevel` を渡している（タイムラインと閾値は同一。リプのみ別しきい値にする案は [DECISIONS.md](../DECISIONS.md) で保留）。
- **`off` のときのみ**閾値超もタイムライン・リプでそのまま見える。
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
