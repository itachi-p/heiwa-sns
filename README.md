# heiwa-sns

いいね数もフォロワー数も表示しないSNS。  
人を「数」で評価しない、新しいコミュニケーションの実験。

---

## ■ 概要

heiwa-snsは、現代のSNSにおける以下の課題に対する解決を目指します。

- 誹謗中傷や人格攻撃が発生しやすい構造
- 数字による評価や比較の圧力
- 安心して発言できない環境

本プロジェクトは、

> **攻撃的な言動が起こりにくく、またメリットを得にくい構造**

を設計することで、心理的安全性の高い空間の実現を目指します。

---

## ■ 設計思想（最重要）

### 1. 人を数で評価しない
いいね数・フォロワー数などの可視化された評価指標に依存しない。

### 2. 攻撃行動の構造的抑制
暴言や差別を「罰する」のではなく、
それが拡散されず、メリットを持たない設計を行う。

### 3. 心理的安全性の確保
ユーザーが安心して発言できる環境を最優先とする。

### 4. 信頼の維持
一貫した設計と運用により、長期的な信頼を築く。

---

## ■ 技術スタンス

- 最小構成から開始し、継続的に改善する
- 技術は手段であり、設計思想を優先する

---

## ■ 現在の状態

- 最小構成の投稿機能を実装済み
- Google ログイン（Supabase Auth）に対応
- ローカルおよびWebで動作確認可能
- UI/UXは未整備

---

## ■ 開発・認証（Google ログイン）

### 環境変数

`.env.local` に以下を設定してください（Supabase ダッシュボードの Project Settings → API）。

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Supabase ダッシュボードでの設定

1. **Authentication → Providers → Google** を有効化し、Google Cloud Console で取得した Client ID / Client Secret を設定する。
2. **Authentication → URL Configuration** の **Redirect URLs** に次を追加する。
   - ローカル: `http://localhost:3000/auth/callback`
   - 本番: `https://<あなたのドメイン>/auth/callback`

### データベース

初回ログイン時に `public.users` へ行を追加するため、マイグレーション  
`supabase/migrations/20260323120000_google_auth_users_and_rls.sql`  
を Supabase の SQL Editor で実行するか、`supabase db push` 等で適用してください。  
（`posts` / `likes` はログインユーザー（JWT）向けの RLS に切り替わります。）

---

## ■ このプロジェクトについて

- 社会的インパクトの創出を目的とする
- 模倣・改善・発展を歓迎する
- 実験的に進化し続ける

---

## ■ License

TBD