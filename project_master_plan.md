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
  - `/` = メインタイムライン（`app/(main)/home/page.tsx`）
  - 認証は Supabase Auth（Google OAuth / メール）
  - 招待コードを組み込んだ新規登録フロー（`/api/invite-signup`, `/api/invite-bind`）

## 2) 主要画面と責務

### 2.1 タイムライン・投稿体験

- `app/(main)/home/page.tsx`
  - 投稿一覧表示、投稿/返信、編集、削除、スキ、画像添付
  - 無限スクロール + 手動「さらに読み込む」
  - セッション/プロフィール状態に応じた UI ゲート
  - モデレーション結果に応じた表示制御（非表示/折りたたみ）
  - 返信ツリー表示（`ReplyThread`）

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
  - パスワード変更必須時の停止（`home/activity` と `home` で利用）

### 2.4 プロフィール・公開導線

- `app/(main)/p/[handle]/page.tsx`
  - 公開IDベースプロフィール（`/@handle` から middleware rewrite）
  - 投稿一覧、スキ、返信、プロフィール情報表示
- `app/(main)/home/[userId]/page.tsx`
  - 旧 UUID 導線。`public_id` があれば `@handle` へリダイレクト

### 2.5 アクティビティ

- `app/(main)/home/activity/page.tsx`
  - 自分の投稿への他者返信を時系列表示
  - 閲覧フィルタ設定に連動して非表示/折りたたみ
  - 閲覧後に `activity_last_seen_at` を更新

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

- `e2e/smoke.spec.ts`: 最小表示確認
- `e2e/unit-timeline-sort.spec.ts`: タイムラインソート純関数検証
- `e2e/timeline-toxicity-filter.spec.ts`: 2ユーザー + service_role でフィルタ挙動検証
- `e2e/invite-flow.spec.ts`: 招待フロー確認
- 補助: `e2e/reset-lent-invite-user.ts`

## 7) 守るべき実装ルール（コードから抽出）

- 投稿/返信操作は `authReady` + `user` + プロフィール状態を確認してから許可する
- 閲覧制御は `moderation_max_score` の生値ではなく `effectiveScoreForViewerToxicityFilter()` を通して判定する
- タイムライン順は `sortTimelinePosts()` を単一の基準関数にする
- 公開IDは `normalizePublicId()` + `isValidPublicIdFormat()` を必ず通す
- 公開プロフィール表示は `public_id` 起点とし、旧 UUID 導線は移行目的でのみ扱う
- モデレーション API は外部依存失敗時も継続可能（degraded fallback）にする
- クライアント保存（localStorage/IDB/sessionStorage）は「表示体験維持」が目的で、DBの真実を置き換えない

## 8) 既知の構造的注意点（現状把握）

- `app/(main)/home/page.tsx` は責務が非常に大きく、今後の変更時に回帰リスクが高い
- モーダル/ゲート（招待・公開ID・パスワード変更）が複数層で重なるため、表示優先度の衝突に注意
- `timeline-toxicity-filter` の E2E は実データ更新前提のため、実行環境分離が必要

## 9) 今後の運用ルール（この文書の扱い）

- この文書は「実装の要約」であり、常にコード変更と一緒に更新する
- 仕様衝突時は、まず実装コードを確認し、この文書を追従更新する
- 変更時は最低限次の3点を再確認する
  - タイムライン順位ロジック
  - 閲覧フィルタ閾値と挙動
  - 招待/公開IDのゲート条件
