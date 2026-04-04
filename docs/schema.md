# データベーススキーマ（heiwa-sns）

**このファイルはリポジトリ上の「意図したスキーマ」の説明書です。** 真実のソースは常に `supabase/migrations/` の累積です。マイグレーションを追加したら **同じ変更でこのファイルを更新**すること。

## 変更のルール（エージェント・人間共通）

1. **`supabase/migrations/` に SQL を足す・既存ファイルを書き換える**のは、**プロジェクトオーナーがそのタスクで明示したときだけ**。
2. 新しいマイグレーションを入れたら **`docs/schema.md` を同じコミットで更新**する（列の追加・削除・型変更をここに反映）。
3. **方針で禁止されている列**（例: 投稿に5指標JSONを永続保存する列）を提案しない。方針変更が必要なら、**先に文章で合意**してからマイグレーション案を書く。
4. 適用済みマイグレーションファイルの**中身を後から書き換えない**（履歴が壊れる）。訂正は新しいマイグレーションで行う。

## 方針メモ（モデレーション）

- **DBに持つのは toxicity の max（0〜1）のみ**（`posts.moderation_max_score` / `post_replies.moderation_max_score`）。初回投稿時と、15分編集確定時の上書きで更新。
- **Perspective の5指標そのものは DB に保存しない**。1行目は投稿送信時の `/api/moderate` 結果を `postScoresById` / `replyScoresById` と dev用 localStorage に保持。編集保存時は `lib/pending-second-moderation` の localStorage フラグで「2行目が未取得」を記録し、**確定後（`pending_content` が消えたあと）** に同じ本文で `/api/moderate` をもう一度呼び 2 行目を埋める（**他端末・未ログインユーザーには 2 行目は共有されない**）。

---

## テーブル一覧

### `public.users`

| 列 | 型 | 備考 |
|----|-----|------|
| id | uuid PK | `auth.users` に紐付け |
| email | text | |
| created_at | timestamptz | |
| nickname | text | ユニーク等はマイグレーション参照 |
| avatar_url | text | |
| avatar_placeholder_hex | text | |
| bio | text | |
| interests | text | レガシー用途の可能性あり（趣味は別テーブルも参照） |
| timeline_toxicity_threshold | real | レガシー（旧UI）。閲覧フィルタは `toxicity_filter_level` を優先 |
| reply_toxicity_threshold | real | レガシー（旧UI） |
| toxicity_filter_level | text | `strict` / `soft` / `normal` / `off`。閾値はアプリ定数で解釈 |
| interest_custom_creations_count | int 等 | マイグレーション参照 |

### `public.posts`

| 列 | 型 | 備考 |
|----|-----|------|
| id | int PK identity | |
| content | text | |
| created_at | timestamptz | |
| user_id | uuid | |
| pending_content | text | 15分編集窓の未確定本文 |
| moderation_max_score | real | 0〜1、**5指標フルは持たない** |
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
| moderation_max_score | real | 0〜1 |

### `public.interest_tags` / `public.user_interests`

趣味・関心タグ。列の詳細は `supabase/migrations/` 内 `interest_tags` / `user_interests` 関連を参照。

### `public.reply_toxic_events`

返信に紐づく toxicity イベント（表示優先度の材料）。`max_score` の範囲はマイグレーションで更新済みの可能性あり。

### `public.user_affinity`

「スキ」で更新する **ユーザー間** の累積スコア（投稿ごとの人気指標は持たない）。

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
