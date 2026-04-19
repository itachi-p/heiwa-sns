# cleanup_audit

`project_master_plan.md` を見直す前段としての作業用メモ。「過去の試行錯誤の残骸」「放置すると混乱を増やしそうなもの」を列挙。
判断後に反映した項目はこの文書から削除し、全項目が片付いたらこの文書自体を破棄する想定。

---

## 1. DB マイグレーション（混乱の痕跡）

同日内で drop → restore しているペアが見られ、「指示していないテーブル/カラムがマイグレーションされた」という記憶と整合。

- `20260329100000 backfill_user_interests_from_users_text`
- `20260329120000 drop_user_interests_use_users_interests`
- `20260329140000 user_interests_restore_drop_users_interests`

この 3 つは 1 日で drop と restore を両方行っており、どちらが「現在の正」か確定仕様と突き合わせる必要がある。現状のスキーマ自体は最後の restore で戻っているはずなので**今すぐ壊れはしない**が、`user_interests` と `users.interests`（text? jsonb?）の関係は要整理。

他に「drop」「legacy」と付くマイグレーション：
- `20260404140000 drop_moderation_scores_first_finalize`
- `20260412100000 users_drop_legacy_toxicity_threshold_columns`

これらは「過去に足して要らなくなったので消した」跡。結果的にクリーンな状態になっているなら問題なし。確認は実 DB の `information_schema` を見るのが確実。

---

## 2. 超大型ファイル

| ファイル | 行数 | コメント |
|---|---|---|
| `components/home/home-page.tsx` | 2809 | 自分のホーム本体（`/@{publicId}` で描画）。プロフィール編集 / 招待・パスワードモーダル / 興味ピッカーを別ファイルへ抽出する余地あり |
| `app/(main)/page.tsx` | 2460 | タイムライン本体 |

依然 5000 行超が 2 ファイルに集中。1 ファイル 1500 行程度までなら Cursor の回帰リスクも減らせる肌感。

---

## 3. コメント/トースト関連の残骸

### 3.1 「再発防止」系コメント

`再発防止|ゾンビ|旧実装|以前は|過去に誤って` を含むコメントが以下に点在。

- `components/home/home-page.tsx`
- `components/home/compose-modal.tsx`
- `components/edit-countdown-badge.tsx`
- `components/reply-thread.tsx`

「同じバグを再発させないため」目的で入れたものだが、実装を変えるとコメントだけ取り残される危険がある。本当に残すべきもの（例: `スキ` ボタン非表示の根拠）と、今となっては意味を失っているものを一度棚卸しすべき。

---

## 4. 公開ID（`public_id`）の DB 層 hardening（未対応）

API 層で形式検証 + 初回限定をしているが、`users_update_own` RLS が列単位で制限していないため、認証済みユーザーが Supabase JS から直接 `update({ public_id: ... })` で API をバイパスできる。defense in depth として DB 側に以下を入れたい。

```sql
-- 形式 CHECK
alter table public.users
  add constraint users_public_id_format
  check (public_id is null or public_id ~ '^[a-z0-9._-]{5,20}$');

-- 不変性トリガー（一度 NOT NULL になったら変更を蹴る）
create or replace function prevent_public_id_change()
returns trigger language plpgsql as $$
begin
  if old.public_id is not null and new.public_id is distinct from old.public_id then
    raise exception 'public_id is immutable once set';
  end if;
  return new;
end $$;

create trigger users_public_id_immutable
before update on public.users
for each row execute function prevent_public_id_change();
```

既存データは正規（API で入れたもの）なので非破壊で追加可能。

---

## 5. setToast 欠落によるサイレントエラー（`app/(main)/page.tsx` `handleSubmit`）

`composeFormError` state 削除の際に判明。以下の失敗ケースはユーザーに何も表示されず silent fail している。本来 `setToast` で通知すべき可能性が高い。挙動変更を伴うため別タスクで判断。

- セッション失効（`!sessionUser?.id`）
- モデレーション API エラー（`!res.ok` / `catch`）
- 投稿 `insert` DB エラー
- 画像アップロード失敗（`!up.ok`）
- 画像メタ update 失敗（`updErr`）
- 画像前処理失敗（`onPick` 内 `!r.ok`）

---

## 6. UX 判断保留: タイムライン初回表示の前倒し

`fetchPosts` は `setPosts(timelinePosts)` を呼んだ後、返信 + 返信プロフィール + dev スコアの取得が完了するまで `setTimelineLoading(false)` を遅らせている。`finally` の位置を `setPosts` 直後に移すと **投稿本文が ~0.5〜1s 早く** 表示できるが、返信件数が一瞬 0 になる「フラッシュ」が発生する可能性あり。実装するか否かは要相談。

---

## 7. 推奨アクション順序（軽いものから）

1. 章 4 の `public_id` DB hardening（マイグレーション 1 ファイル追加）
2. 章 5 の setToast 欠落解消（挙動変更あり・要相談）
3. 章 6 のタイムライン表示前倒し（UX トレードオフ・要相談）
4. 章 2 `home-page.tsx` の分割: プロフィール編集モーダル、招待 / パスワード変更モーダル、興味ピッカーを別ファイルへ
5. 章 3.1 再発防止コメントの棚卸し: コードで不変条件を表現する方向（関数名 / 型 / テスト）に寄せて、コメントは最小限に
6. 章 1 DB スキーマ整理: 実 DB の `information_schema.columns` を一度ダンプし、`project_master_plan.md` のデータモデル節（現状ほぼ未記載）に反映

---

## 8. 本文書の運用

- 実装の真実は `project_master_plan.md` とコードに寄せる方針。本文書の推測は手元で確認してから採用。
- 片付いた項目は該当セクションごと削除。
- 新しい「残骸っぽいもの」を見つけたら追記。
- 新しいチャットを開いた際は、AI に本文書を読み込ませて「次にやるべき軽い項目」を提案させ、完了したら本文書と `project_master_plan.md` を即更新する運用を推奨。
