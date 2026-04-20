# project_master_plan

この文書は、現時点の実装コードを基準にしたプロジェクトの統合整理です。  
以後の判断では、実コードとの差分が出た場合は実コードを優先して更新してください。

## 1) プロジェクト概要（現行実装ベース）

- 名称: `Nagi SNS`（`app/layout.tsx`）
- 目的（README・実装の共通点）:
  - 数値評価依存を弱める（「スキ」はあるが件数表示なし）
  - 攻撃的投稿の拡散抑制（投稿単位でモデレーションスコア処理）
  - 閲覧者ごとに表示制御できるタイムライン
- 主導線:
  - `/` = メインタイムライン（`app/(main)/page.tsx`）
  - `/@{publicId}` = 自分のホーム兼公開プロフィール（`app/(main)/p/[handle]/page.tsx`、自分の場合は `components/home/home-page.tsx` を描画）
  - `/home/activity` = 自分の投稿への返信一覧
  - `/settings` = ブックマーク用のエントリ。実体はタイムラインへ戻して設定モーダルを開くだけ
  - 認証は Supabase Auth（Google OAuth / メール）
  - 招待コードを組み込んだ新規登録フロー（`/api/invite-signup`, `/api/invite-bind`）

## 2) 主要画面と責務

### 2.1 タイムライン・投稿体験

- `app/(main)/page.tsx`（URL: `/`）
  - メインタイムライン（全ユーザーの投稿一覧）
  - 投稿/返信、編集、削除、スキ、画像添付
  - 無限スクロール + 手動「さらに読み込む」
  - セッション/プロフィール状態に応じた UI ゲート（`tryInteraction`）
  - モデレーション結果に応じた表示制御（非表示/折りたたみ）
  - 返信ツリー表示（`ReplyThread`）
- `components/home/home-page.tsx`
  - 自分のホームとして `/@{publicId}` 配下で描画される。独立した route ファイルは持たない
  - 自分の投稿/返信のみ表示。投稿/返信操作、編集、削除、画像添付
  - 自分の投稿/返信には「スキ」ボタンを出さない（仕様）
- 「スキ」の挙動:
  - 自分自身の投稿/返信にはボタン自体を出さない
  - 非ログイン/プロフィール未確定時にクリックされた場合は「スキや投稿にはログインが必要です」を通知（タイムラインでは `tryInteraction` モーダル、公開プロフィールでは `errorMessage` バナー）
- 編集ウィンドウの残り時間表示:
  - `components/edit-countdown-badge.tsx` が各投稿/返信の編集モーダル内部で独立して 1 秒刻みの再描画を行う
  - タイムライン全体で setInterval を回す旧実装は廃止済み（再発防止）

### 2.2 認証・ヘッダー

- `components/site-header.tsx`
  - Google OAuth ログイン
  - メールログイン
  - 招待コード付きメール新規登録
  - ログイン中ユーザー表示とログアウト

### 2.3 初回オンボーディング（ブロッキング）

- `components/invite-onboarding-layer.tsx`
  - 招待コード未登録ユーザーをモーダルで停止
- `components/public-id-required-layer.tsx`
  - 公開ID未設定ユーザーをモーダルで停止
  - 公開IDは一度設定したら変更不可（API側で再設定拒否）
- `components/must-change-password-modal.tsx`
  - パスワード変更必須時の停止（`/`、`/home/activity`、`/@{publicId}`（自分のホーム）で利用）

### 2.4 プロフィール・公開導線

- `app/(main)/p/[handle]/page.tsx`
  - 公開IDベースプロフィール（`/@handle` は `middleware.ts` で `/p/[handle]` に rewrite）
  - 閲覧者==所有者の場合は `components/home/home-page.tsx` を描画（自分のホーム）
  - 閲覧者!=所有者の場合は他者プロフィールビュー（投稿一覧、スキ、返信、プロフィール情報表示）
  - 非ログイン閲覧者は投稿/返信の「スキ」ボタンに対してログイン要求通知を出す
- 旧 `/home` ルートおよび `/home/[userId]` ルートは廃止済み
  - `/home` は `/@{publicId}` に統合、`/home/[userId]` は UUID を URL に露出させないため削除
  - 自分のホームを開く導線は常に `/@{publicId}`

### 2.5 アクティビティ（下部メニュー「リプ」）

- `app/(main)/home/activity/page.tsx`（URL: `/home/activity`）
- 表示ルール: **「自分が直接の親」となる返信のみ** を時系列表示する
  - A) ルート投稿（`parent_reply_id IS NULL`）で、その投稿主が自分
  - B) 親が返信の場合、親返信の投稿者が自分
  - どちらも `post_replies.user_id != 自分`（自分の返信は出さない）
- 旧仕様（自分のルート投稿配下の全返信を表示し、他人投稿配下の自分の返信に付いた返信は出さない）から変更済み
- 実装は自己参照 join を避けるため A と B を 2 クエリで取得し、id でマージ→`created_at` 降順→上限 100 件
- 閲覧フィルタ設定に連動して非表示/折りたたみ
- 閲覧後に `activity_last_seen_at` を更新
- 元投稿へのリンクは「ルート投稿のオーナー」の `public_id` を使って `/@{owner}?post={postId}&reply={replyId}` に飛ばす
  - 自分のルート投稿配下なら `/@{自分のpublicId}?post=X&reply=Y`
  - 他人のルート投稿配下で自分の返信に付いた返信なら `/@{相手のpublicId}?post=X&reply=Y`
  - 着地先（`components/home/home-page.tsx` と `app/(main)/p/[handle]/page.tsx` 非 owner 側）は、
    ルート投稿 `#home-post-{X}` にスクロール → `openedReplyPosts` へ post id を追加してリプ欄を自動展開 →
    返信 DOM `#reply-{Y}`（`components/reply-thread.tsx` の `<li>` に付与）へ追加スクロール、の 3 段を実施する
  - `app/(main)/p/[handle]/page.tsx` 非 owner 側は返信本体を遅延取得しているため、`fetchRepliesForPost` を await してから `reply-{Y}` スクロールを発火
  - 吹き出しアイコンの色（返信 1 件以上で sky 系に点灯）は、`p/[handle]/page.tsx` 非 owner 側では `post_replies.select("post_id").in(...)` を一括で投げて `replyCountByPost` に件数だけキャッシュし、リプ欄未展開でも正しく点灯させる（開いた瞬間に初めて色が付く回帰の再発防止）
- このアプリは外部通知を出さない設計のため、「リプ」画面が事実上の「あなたへの返信通知」位置づけ
  - 関連する固定文言は出さないが、表示の意味づけは「自分宛のリプライ一覧」と理解すること

### 2.6 設定

- `app/(main)/settings/page.tsx`
  - 独立画面ではなく、`/` へ戻して設定モーダルを開くだけ
- `components/toxicity-settings-modal.tsx`
  - 閲覧フィルタ強度（strict/soft/normal/off）
  - 閾値超過時の挙動（hide/fold）

## 3) API / サーバーサイド機能

### 3.1 モデレーション

- `app/api/moderate/route.ts`
  - `TOXICITY, SEVERE_TOXICITY, INSULT, PROFANITY, THREAT` を返す
  - Perspective API 利用、失敗時は mock へフォールバック
  - `overallMax` を返し、投稿/返信保存時の `moderation_max_score` に利用

### 3.2 招待フロー

- `app/api/invite-signup/route.ts`
  - 招待トークン検証 -> Supabase Admin でユーザー作成 -> トークン消費
  - `users` 行へ `is_invite_user`, `invite_label`, `invite_onboarding_completed` 反映
- `app/api/invite-bind/route.ts`
  - 既存ログインユーザー向け招待コード消費

### 3.3 公開ID・公開プロフィール

- `app/api/set-public-id/route.ts`
  - フォーマット検証後に `users.public_id` を初回のみ設定
  - 重複・再設定を明示的に拒否
- `app/api/public-profiles/route.ts`
  - 複数 userId の公開プロフィール情報を返す内部 API

### 3.4 編集確定・補助

- `app/api/finalize-my-pending/route.ts`
- `app/api/finalize-pending-edits/route.ts`
  - `pending_content` の確定処理を担う API 群
  - クライアント側はタイムライン取得時にバックグラウンド呼び出し

## 4) 技術スタック

- フロント/フレームワーク
  - Next.js 16（App Router）
  - React 19
  - TypeScript 5
- バックエンド
  - Supabase（Auth + Postgres + Storage + RPC）
  - `@supabase/ssr` + `@supabase/supabase-js`
- UI/CSS
  - Tailwind CSS v4
- PWA
  - `@ducanh2912/next-pwa`
- テスト
  - Playwright（E2E + 一部純関数テスト）
- 品質
  - ESLint（Next config）

## 5) データ/ドメインの中核仕様（コードから読み取れる事実）

### 5.1 タイムライン順位

- `lib/timeline-sort.ts` の仮想時刻ソート
  - 基本は `created_at` 降順
  - スキ関係（`user_affinity.like_score`）で微ブースト
  - 自分投稿に微ブースト
  - 高攻撃性投稿にはペナルティ
  - 同値時は `id` 降順で安定化

### 5.2 閲覧フィルタ

- `lib/toxicity-filter-level.ts`
  - レベル: `strict(0.3)`, `soft(0.5)`, `normal(0.7)`, `off(1.0)`
  - 閾値超過挙動: `hide` or `fold`
  - ノイズ床: `<=0.2` は比較上 0 扱い

### 5.3 投稿/返信モデレーション保存

- 保存時点で `moderation_max_score` + `moderation_dev_scores.first` を持てる
- 編集後確定時に `second` スコアを再採点し永続化する設計
- 2段目未処理IDは localStorage/IDB で管理し、後続処理で回収

### 5.4 編集ウィンドウ

- 投稿/返信は一定時間編集可能
- 編集保存は `pending_content` に入り、即時反映ではなく遅延確定

### 5.5 公開IDルール

- 正規化して保存（小文字化）
- 一度設定すると再変更不可
- `@handle` 表示導線を middleware で `/p/[handle]` に rewrite

## 6) テスト構成（現行）

- `e2e/unit-timeline-sort.spec.ts`: タイムラインソート純関数検証
- `e2e/timeline-toxicity-filter.spec.ts`: 2ユーザー + service_role でフィルタ挙動検証
- `e2e/invite-flow.spec.ts`: 招待フロー確認
- 補助: `e2e/reset-lent-invite-user.ts`

## 7) 守るべき実装ルール（コードから抽出）

- 投稿/返信操作は `authReady` + `user` + プロフィール状態を確認してから許可する
- 閲覧制御は `moderation_max_score` の生値ではなく `effectiveScoreForViewerToxicityFilter()` を通して判定する
- タイムライン順は `sortTimelinePosts()` を単一の基準関数にする
- 公開IDは `normalizePublicId()` + `isValidPublicIdFormat()` を必ず通す
- 公開プロフィール表示は `public_id` 起点とする（UUID を URL に露出させないため、旧 UUID 導線は廃止済み）
- ログアウト時は `app/(main)/layout.tsx` で常に `/` に replace する（`/@{自分のpublicId}` に留まって「前のユーザーの画面を見続けている」錯覚を防ぐため）
- モデレーション API は外部依存失敗時も継続可能（degraded fallback）にする
- クライアント保存（localStorage/IDB/sessionStorage）は「表示体験維持」が目的で、DBの真実を置き換えない
- `components/reply-thread.tsx` のドラフト透過は条件付きで早期に空文字へ置換しない（ネストした子返信を編集すると常に空白が降ってきて textarea が空になる回帰の再発防止）。textarea 自体が `editingReplyId === reply.id` のときだけ mount されるので生値透過で正しい
- インライン返信フォーム（「〇〇に返信」プレースホルダーが出る `bottom-2 z-[56]` の固定フォーム）が開いている間は、`components/reply-active-bus.ts` 経由で `MainBottomNav` を非表示にする。理由：「+」誤押下で新規投稿モーダル（`bottom-20 z-[55]`）がインライン返信フォームと重畳して操作不能になる回帰の再発防止。各描画元（`app/(main)/page.tsx` / `components/home/home-page.tsx` / `app/(main)/p/[handle]/page.tsx`）は `useEffect` で `setReplyActive(inlineReplyPostId != null)` を呼び、unmount／閉時に `false` を投げる契約。layout 側は `useSyncExternalStore` で購読
- `app/(main)/page.tsx` の `handleSubmit`（新規投稿）の失敗ケースは `setToast({ tone: "error" })` でユーザーに必ず通知する。サイレントに `return` しない（cleanup_audit 旧章 4 の再発防止）。対象: モデレーション API !ok / network catch、セッション失効、posts insert エラー、posts insert 後 data 欠落、画像アップロード失敗、画像メタ update 失敗、画像前処理失敗（`onPick` 内 `!r.ok`）。DB エラー文言は `friendlyClientDbMessage` を通す
- ニックネームは任意・変更可（旧仕様のデッドカラム `users.nickname_locked` はマイグレーション `20260419120000_users_drop_nickname_locked.sql` で drop 済み）。一方 `public_id` は初回必須・変更不可（API で 409）。DB 層でも `20260419130000_users_public_id_hardening.sql` で形式 CHECK（`^[a-z0-9._-]{5,20}$`）と不変性トリガー（NOT NULL 以降の UPDATE を `raise exception`）を設置済み = 直叩き update もバイパス不可

## 8) 既知の構造的注意点（現状把握）

- `components/home/home-page.tsx`（自分のホーム本体、約 2.8k 行）と `app/(main)/page.tsx`（タイムライン本体、約 2.5k 行）はまだ責務が大きく、分割余地あり（GitHub Issue #1）
- モーダル/ゲート（招待・公開ID・パスワード変更）が複数層で重なるため、表示優先度の衝突に注意
- `timeline-toxicity-filter` の E2E は実データ更新前提のため、実行環境分離が必要
- `.history/` は VS Code の自動ローカル履歴。`.gitignore` 対象で Git 管理しない

## 9) 今後の運用ルール（この文書の扱い）

- この文書は「実装の要約」であり、常にコード変更と一緒に更新する
- 仕様衝突時は、まず実装コードを確認し、この文書を追従更新する
- 変更時は最低限次の3点を再確認する
  - タイムライン順位ロジック
  - 閲覧フィルタ閾値と挙動
  - 招待/公開IDのゲート条件
