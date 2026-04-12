# 実装参照（アルゴリズム・データの真）

**読者**: 開発者・Cursor。**ユーザー向け説明**は [`../INVITE_DEEP_DIVE.md`](../INVITE_DEEP_DIVE.md) から辿る。

この文書は **現行コード** に合わせて維持する。数式や閾値を変えたら **同じ変更で本ファイル**（必要なら [`../PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md`](../PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md)）も更新する。

---

## 1. タイムライン表示順（トップ `app/page.tsx`）

処理順: **ページング取得**（20件ずつ）→ **毒性フィルタ/折りたたみ** → **並び替え**（`lib/timeline-sort.ts` の `sortTimelinePosts`）。

### 1.1 毒性による除外・折りたたみ（他人投稿のみ）

- 閲覧者の `toxicity_filter_level` → 閾値は `lib/toxicity-filter-level.ts` の `TOXICITY_THRESHOLDS`（`strict` 0.3 / `soft` 0.5 / `normal` 0.7 / `off` 1.0）。
- 未ログイン閲覧は `ANON_TOXICITY_VIEW_THRESHOLD`（`soft`=0.5）かつ `hide` 固定で扱う。
- 比較対象は `moderation_max_score`（DB・投稿ごとに固定）を **`effectiveScoreForViewerToxicityFilter` で閲覧用に変換した値**（ノイズフロア `TOXICITY_SCORE_NOISE_FLOOR`、既定 0.2）。保存値そのものは変えない。
- 閲覧者の `toxicity_over_threshold_behavior` が `hide` のとき、**`effectiveScore > thresholdForLevel(level)`** ならタイムラインから除外（自分投稿は常に残す）。
- `fold` のときはタイムラインから除外せず、投稿・返信ともに「表示制限」カードで折りたたみ表示（展開で本文を表示）。

### 1.3 ページング（トップ）

- `app/page.tsx` は `TIMELINE_PAGE_SIZE`（既定 20）で `posts` を `range()` 取得。
- 初回ロード後は「さらに読み込む」で追加ページを取得し、既存配列に id 重複なく結合。
- 初回取得中は「まだ投稿がありません」ではなく読み込み文言を表示（空表示ちらつき軽減）。

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

## 1.4 入力文字数（クライアント先行）

- 定数: `lib/compose-text-limits.ts` の `POST_AND_REPLY_MAX_CHARS`（300）・`PROFILE_BIO_MAX_CHARS`（150）。
- タイムライン投稿・返信の新規・編集・返信モーダル・`ReplyThread` の編集欄で `maxLength` と送信前チェックに使用。自己紹介はマイホームのプロフィール編集で同様。
- フローティング新規投稿（`/`・`/home`）: 本文なし投稿は `AppToastPortal`（`setToast`）で通知。フロート内 `composeFormError` と併用可。オープン時は `AutosizeTextarea` の ref で `focus({ preventScroll: true })`。空＋画像なしのときは投稿ボタンを `disabled`。

---

## 2. 毒性・UI メッセージ（投稿者向け注意など）

- 投稿・返信直後の投稿者向け注意: `overallMax >= HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD`。値は **`TOXICITY_THRESHOLDS.normal`（標準・0.7）と同一**（`lib/toxicity-filter-level.ts`）。文言・表示形式は `lib/visibility-notice.ts` および `app/page.tsx` / `app/home/page.tsx` の既存定数のまま。
- 閲覧側: 閾値は `thresholdForLevel(level)` を共通利用。`toxicity_over_threshold_behavior` が `hide` なら閾値超を非表示、`fold` なら折りたたみ（投稿・返信とも同一方針）。
- **`off` のときのみ**閾値超もタイムライン・リプでそのまま見える。
- 返信折りたたみ等の UI 文言・条件は `app/page.tsx` / `app/home/page.tsx` を参照（変更時は本書に一行追記可）。

---

## 3. スキ（いいね）とデータ

- **投稿にいいね数は表示しない**（集計カラムも持たない方針）。
- `likes` テーブル: `user_id`, `post_id`, `created_at`（重複防止）。
- タイムライン優先度に効くのは **`user_affinity.like_score`**（ユーザー間の減衰付き累積）。詳細は `supabase/migrations/` 内 RPC 定義。
- トップ `app/page.tsx` の「スキ」成功後は **タイムライン全体の `fetchPosts` を呼ばない**（スクロールが先頭に戻るのを防ぐ）。`user_affinity` 反映後の並びは、次の一覧取得・ポーリングで追従する。

---

## 4. モデレーションスコアの保存方針

- **閲覧フィルタに使うのは `moderation_max_score`（0〜1）のみ**（投稿・返信）。
- **開発用 5 指標**は `moderation_dev_scores`（jsonb、任意）に `{ first, second }` で保存し、**全クライアントで共有**。フィルタ・公開ランキングには使わない。補助キャッシュは localStorage / IndexedDB（[`../PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md`](../PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md) 参照）。

---

## 5. 招待・初回パスワード変更（`users.must_change_password`）

- **先行体験・メール**: **本人確認（受信メール）必須のまま**運用する（ダミーメアド不可の方針）。未確認の `signInWithPassword` は **「Email not confirmed」**。手早い検証は **既存アカウント貸与**（受信可能なメール＋パスでログイン、E2E 3 番相当）。**`/api/invite-signup`** は `auth.admin.createUser` で **`email_confirm: false`** のユーザを作る（API 経路の技術メモ。プロジェクトの「ログインに確認必須」との関係は運用で整理）。
- **DB**: `users.is_invite_user` / `users.must_change_password` / `users.invite_label`（`docs/schema.md`・マイグレーション参照）。既存行はデフォルトでゲートに掛からない。
- **招待メール新規登録**（`/api/invite-signup`）: トークン消費後に `is_invite_user=true`・`must_change_password=false`・`invite_label` を付与（`lib/invite-label.ts` の採番。一意衝突時は再試行）。
- **ニックネーム未設定**（`needsNickname`）: `users.nickname` が **null・空・空白のみ**のとき `NicknameRequiredModal` を出す（`app/(main)/page.tsx` / `app/(main)/home/page.tsx`）。
- **貸与アカウント**: 運用で `must_change_password=true`（および必要なら `invite_label`）を付与。初回ログイン後は **`MustChangePasswordModal`**（`components/must-change-password-modal.tsx`）でパスワード変更を必須にし、成功後に `must_change_password=false` を自分の行へ `update`（`supabase.auth.updateUser` と続けて実行）。
- **強度**: `lib/invite-password.ts`（8 文字以上・英字＋数字）。
- **表示**: トップ `app/page.tsx`・マイホーム `app/home/page.tsx`・`app/home/activity/page.tsx`・自分の `app/home/[userId]/page.tsx` で `must_change_password===true` の間はニックネーム設定より先に当該モーダルを出し、操作は `canInteract` 相当でブロック（または閲覧を抑止）。

---

## 6. 関連ソース一覧（変更時チェック）

| 領域 | 主なファイル |
|------|----------------|
| ログイン UI（Google ＋ メール／パスワード） | `components/site-header.tsx` |
| タイムライン取得・フィルタ・呼び出し | `app/(main)/page.tsx`（`fetchPosts`） |
| 並び純関数 | `lib/timeline-sort.ts` |
| 毒性閾値・ノイズフロア | `lib/toxicity-filter-level.ts` |
| 匿名時の閾値 | `lib/timeline-threshold.ts` |
| 5 指標（DB + キャッシュ） | `lib/moderation-dev-scores-db.ts`, `app/api/persist-moderation-dev-scores/route.ts`, `lib/persist-moderation-dev-scores-client.ts`, `lib/moderation-scores-indexeddb.ts`, `lib/pending-second-moderation.ts`, `lib/second-moderation-timing.ts` |
| E2E | `playwright.config.ts`, `e2e/` |
| スキーマ意図 | [`../schema.md`](../schema.md), `supabase/migrations/` |
| アクティビティ | `app/(main)/home/activity/page.tsx`（投稿プレビューは `/home?post={id}` へ、`app/(main)/home/page.tsx` で `home-post-{id}` へスクロール）。相対時刻 `lib/format-relative-time-ja.ts`、プレビュー `lib/post-content-preview.ts`。開いたとき `users.activity_last_seen_at` を更新 |
| 閲覧フィルタ UI | `components/toxicity-settings-modal.tsx`（`app/(main)/layout.tsx` で表示。`/settings` はモーダル起動＋`/` へ `replace`） |
| 下部ナビ・招待コードモーダル | `app/(main)/layout.tsx`, `components/main-bottom-nav.tsx`, `components/invite-onboarding-layer.tsx` |
| Google 等の招待コード紐付け | `app/api/invite-bind/route.ts` |
| 招待サインアップ API | `app/api/invite-signup/route.ts` |
| プロフィール外部リンク検証 | `lib/sanitize-external-url.ts` |
| 初回パスワード変更 UI | `components/must-change-password-modal.tsx`, `lib/invite-password.ts`, `lib/invite-label.ts` |
