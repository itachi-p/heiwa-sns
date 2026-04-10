# データベーススキーマ（heiwa-sns）

**このファイルはリポジトリ上の「意図したスキーマ」の説明書です。** 真実のソースは常に `supabase/migrations/` の累積です。マイグレーションを追加したら **同じ変更でこのファイルを更新**すること。

## 変更のルール（エージェント・人間共通）

1. **`supabase/migrations/` に SQL を足す・既存ファイルを書き換える**のは、**プロジェクトオーナーがそのタスクで明示したときだけ**。
2. 新しいマイグレーションを入れたら **`docs/schema.md` を同じコミットで更新**する（列の追加・削除・型変更をここに反映）。
3. スキーマ方針を変える列は、**オーナー合意とマイグレーション**のセットで入れる（既存マイグレーションの書き換えはしない）。
4. 適用済みマイグレーションファイルの**中身を後から書き換えない**（履歴が壊れる）。訂正は新しいマイグレーションで行う。

## 方針メモ（モデレーション）

- **閲覧フィルタに使うのは toxicity の max（0〜1）のみ**（`posts.moderation_max_score` / `post_replies.moderation_max_score`）。初回投稿時と、15分編集確定時の上書きで更新。
- **開発用の Perspective 5 指標（1行目・2行目）**は `moderation_dev_scores`（jsonb、任意）に保存する。1行目は投稿・返信 insert 時、2行目は編集窓経過後のクライアント再採点＋`/api/persist-moderation-dev-scores`、または pending 確定処理（`finalize-pending-edits-core`）で追記。一覧取得で全員が読める。localStorage / IndexedDB はキャッシュ。

---

## テーブル一覧

### `public.users`

| 列 | 型 | 備考 |
|----|-----|------|
| id | uuid PK | `auth.users` に紐付け |
| email | text | |
| created_at | timestamptz | |
| is_invite_user | boolean | デフォルト false。招待経路で作成したユーザーなど |
| must_change_password | boolean | デフォルト false。true のときログイン後にパスワード変更を必須にする |
| invite_label | text | 任意。非 NULL 値は一意（招待識別用ラベル） |
| nickname | text | ユニーク等はマイグレーション参照 |
| avatar_url | text | |
| avatar_placeholder_hex | text | |
| bio | text | |
| interests | text | レガシー用途の可能性あり（趣味は別テーブルも参照） |
| toxicity_filter_level | text | `strict` / `soft` / `normal` / `off`。閾値はアプリ定数で解釈 |
| toxicity_over_threshold_behavior | text | `hide` / `fold`。閾値超コンテンツを非表示にするか折りたたむか |
| interest_custom_creations_count | int 等 | マイグレーション参照 |
| invite_onboarding_completed | boolean | 招待コード紐付け完了（メール新規登録 API か `POST /api/invite-bind` で true） |
| nickname_locked | boolean | true のときニックネーム変更不可（初回確定後・先行体験中など） |
| profile_external_url | text | 任意。プロフィール用外部リンク（https のみ・アプリ側で検証） |
| activity_last_seen_at | timestamptz | 任意。アクティビティを最後に開いた時刻（未読比較用） |

### `public.posts`

| 列 | 型 | 備考 |
|----|-----|------|
| id | int PK identity | |
| content | text | |
| created_at | timestamptz | |
| user_id | uuid | |
| pending_content | text | 15分編集窓の未確定本文 |
| moderation_max_score | real | 0〜1（フィルタ用） |
| moderation_dev_scores | jsonb | 任意。開発表示用 `{ "first": {ATTR: score}, "second": {...} }` |
| image_storage_path | text | 任意。Storage **`post-images`** バケット内パス（`{user_id}/{post_id}.{ext}`） |

### Storage（投稿画像）

- バケット **`post-images`**（public）。認証ユーザーは自分の `user_id` フォルダ配下のみ upload/update/delete。読み取りは公開。

### `public.likes`

| 列 | 型 | 備考 |
|----|-----|------|
| user_id | uuid | |
| post_id | int FK → posts | |
| created_at | timestamptz | unique (user_id, post_id) |

### `public.post_replies`

| 列 | 型 | 備考 |
|----|-----|------|
| id | bigint PK | |
| post_id | int FK | |
| user_id | uuid FK | |
| content | text | |
| created_at | timestamptz | |
| parent_reply_id | bigint | スレッド用、マイグレーション参照 |
| pending_content | text | 編集未確定 |
| moderation_max_score | real | 0〜1（フィルタ用） |
| moderation_dev_scores | jsonb | 任意。開発表示用 `{ "first", "second" }` |

### `public.interest_tags` / `public.user_interests`

趣味・関心タグ。列の詳細は `supabase/migrations/` 内 `interest_tags` / `user_interests` 関連を参照。

### `public.reply_toxic_events`

返信に紐づく toxicity イベント（表示優先度の材料）。`max_score` の範囲はマイグレーションで更新済みの可能性あり。

### `public.invite_tokens`

先行テストの招待コード管理。`token` が未使用 (`is_used=false`) の場合のみ登録に利用する。

| 列 | 型 | 備考 |
|----|-----|------|
| id | bigint PK | identity |
| token | text | 一意な招待トークン |
| is_used | boolean | 1回使用後 true |
| used_at | timestamptz | 使用時刻 |
| used_by_user_id | uuid | 使用した `auth.users.id` |
| used_by_email | text | 使用メール |
| note | text | 配布メモ（任意） |
| created_at | timestamptz | 作成時刻 |

**SQL 関数（マイグレーションで定義）**

- `generate_invite_token()` … 6 文字の英小文字+数字（衝突チェックはしない）
- `create_invite_tokens(p_count int)` … 上記で重複しない `token` を `p_count` 件 `insert`

運用例（SQL エディタ・`service_role` 相当）: `select create_invite_tokens(10);`  
一覧: `select * from invite_tokens order by created_at desc;`

### `public.user_affinity`

「スキ」で更新する **ユーザー間** の累積重み（タイムライン順の補助。投稿ごとの人気指標は持たない）。製品説明では「親密度」という語は使わない（人を数字で評価しない方針）。Supabase のテーブルコメントも同趣旨。

| 列 | 型 | 備考 |
|----|-----|------|
| from_user_id | uuid PK(複合) | `users` FK |
| to_user_id | uuid PK(複合) | `users` FK |
| like_score | float8 | 減衰付き累積。更新は `apply_user_affinity_on_like` RPC のみ想定 |

---

## 履歴

| 日付 | 内容 |
|------|------|
| 2026-04-02 | 初版作成。マイグレーションから集約。 |
| 2026-04-05 | `user_affinity`・スキ由来タイムライン優先度。 |
| 2026-04-10 | `posts.image_storage_path`・バケット `post-images`。 |
| 2026-04-11 | `posts` / `post_replies` に `moderation_dev_scores`（jsonb）。 |
| 2026-04-12 | `users` から `timeline_toxicity_threshold` / `reply_toxicity_threshold` を削除（閲覧は `toxicity_filter_level` のみ）。`user_affinity` に中立なテーブルコメント。 |
| 2026-04-13 | `users.toxicity_over_threshold_behavior` を追加（`hide`/`fold`）。 |
| 2026-04-13 | `invite_tokens` を追加（招待トークンの1回利用管理）。 |
| 2026-04-14 | `generate_invite_token` / `create_invite_tokens` を追加（トークン一括生成）。 |
| 2026-04-10 | `users` に `is_invite_user` / `must_change_password` / `invite_label` を追加。 |
