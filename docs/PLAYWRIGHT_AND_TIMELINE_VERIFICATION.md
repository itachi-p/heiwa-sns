# Playwright（E2E）とタイムライン検証

**開発者向け**（E2E 方針・手動検証）。**数式・閾値の一覧**は重複を避け [`dev/IMPLEMENTATION_REFERENCE.md`](dev/IMPLEMENTATION_REFERENCE.md) を正とする。

この文書は次の3つを兼ねる。

1. **E2E テストに Playwright を使う方針**と、初めて触る人向けの最小手順
2. **「スキ」**（`user_affinity`）と **表示順** の設計の要約（外説明・リマインド用）
3. **手動で順序を確かめる手順**（協力者テストや回帰確認用）

実装の真実は常にコードである。手順の根拠は **`app/page.tsx` の `fetchPosts`** と **`lib/timeline-sort.ts`** と **`dev/IMPLEMENTATION_REFERENCE.md`** を照合すること。

---

## 1. Playwright を使う方針

- **ブラウザで実際に動く経路**（表示・遷移・主要操作）の回帰を、**E2E で自動化する**ときの既定スタックは **Playwright**（`@playwright/test`）とする。
- 単体の純関数・API の単体テストが必要になった場合は、別途 Jest 等を検討してよい（本ドキュメントの対象外）。
- テストファイルはリポジトリ直下の **`e2e/`** に置く。設定は **`playwright.config.ts`**。

**やらないこと（方針の固定）**

- この文書だけを更新してコードと矛盾させない。仕様変更したら **コードと本書の両方**を更新するか、意図的に「未整備」と明記する。
- **データベースのスキーマ変更**（マイグレーション）は、オーナーの明示指示なしに E2E 用などを理由に追加しない。

---

## 2. Playwright とは（超短い説明）

**実際のブラウザ（Chromium 等）を自動で操作し、画面に何が表示されるか・ボタンが押せるかを検証するツール**です。手動で毎回ブラウザを開く代わりに、`e2e/*.spec.ts` にシナリオを書いて `npm run test:e2e` で繰り返し実行できます。

公式ドキュメント: [https://playwright.dev/](https://playwright.dev/)

---

## 3. 環境準備と実行

前提: Node.js と依存関係が入っていること（`npm install` 済み）。

1. **ブラウザバイナリの初回取得**（初めてのマシンだけでよい）

   ```bash
   npx playwright install chromium
   ```

2. **E2E 実行**

   ```bash
   npm run test:e2e
   ```

   `playwright.config.ts` では **`npm run dev` を自動起動**し、`http://127.0.0.1:3000` に対してテストする設定になっている（既に dev が動いていれば再利用）。

3. **UI モード**（ステップ実行・デバッグ向け）

   ```bash
   npm run test:e2e:ui
   ```

4. **ヘッドあり**（ブラウザを見せながら）

   ```bash
   npm run test:e2e:headed
   ```

**Supabase / ログインが必要なシナリオ**を E2E に書く場合は、`.env.local` の有無・テスト用アカウント・CI のシークレットなどを別途設計する（現状の `e2e/smoke.spec.ts` は未ログインのトップ表示のみ）。**`e2e/filtering.spec.ts`** は閲覧フィルタの帯を確定させるため、テスト用投稿の `moderation_max_score` を **`SUPABASE_SERVICE_ROLE_KEY` で上書き**する（`NEXT_PUBLIC_SUPABASE_URL` も必要）。API の自動採点だけでは帯が揺れるため。

- **`e2e/invite-flow.spec.ts`**（先行体験 **3番**: 貸与メール＋パスでログイン → 必要なら招待・初回パス変更・ニックネーム → 初投稿）: 必須 **`E2E_LOGIN_EMAIL`** / **`E2E_LOGIN_PASSWORD`**。任意 **`INVITE_CODE`**（招待未紐付けユーザ向け）、**`E2E_FIRST_LOGIN_NEW_PASSWORD`**（`must_change_password` 時の初回変更）。未設定でスキップになるのはメール／パスだけ。`.env.local` に同じキー名で書けば **`npm run test:e2e -- e2e/invite-flow.spec.ts` だけ**でも可（`e2e/load-env-local.ts`）。シェルで一時指定する例: `E2E_LOGIN_EMAIL=user02@test.com E2E_LOGIN_PASSWORD=… npm run test:e2e -- e2e/invite-flow.spec.ts`。タイムアウト **120s**、ログイン後モーダルは最大 **約 12s** ずつ検出して分岐。**各テスト後**に `e2e/reset-lent-invite-user.ts` で `public.users`（貸与初回相当のフラグ・`invite_label` など）と **Auth パスワードを `E2E_LOGIN_PASSWORD` に復帰**、`INVITE_CODE` があれば **`invite_tokens` を未使用に戻す**（要 **`SUPABASE_SERVICE_ROLE_KEY`**。無効化は **`E2E_LENT_TEARDOWN=0`**）。**`nickname` は更新しない**（E2E で付けたニックネームは残る）。招待モーダルで **無効・消費済み**のときはアラートに「招待コードが無効」が出て **その時点でテスト成功**（以降のニックネーム・投稿はスキップ）。

---

## 4. テスト追加の目安

- ファイル名: `e2e/<機能>.spec.ts`
- **何の設計を守っているか**を `test.describe` またはコメントで1行書いておくと、後から外れた変更を防ぎやすい。
- アサーションは **ユーザーに見える文言やロール**を優先（実装詳細の class 名だけに依存しない）。

---

## 5. タイムラインの「表示順」の実装要約

対象: **トップページ（`app/page.tsx`）のタイムライン**。データ取得後、**攻撃性フィルタ** → **`sortTimelinePosts`**（`lib/timeline-sort.ts`）。

### 5.1 攻撃性フィルタ（非表示）

- 閲覧者の **`toxicity_filter_level`** から閾値を決め（`lib/toxicity-filter-level.ts`）、他人の投稿は **`moderation_max_score`（ノイズフロア適用後）が閾値を超えたものを除外**。
- **自分の投稿**は閾値に関係なく常に含める。

### 5.2 ソートキー（残った投稿の並び）

**要点のみ**（定数・式はすべて [`dev/IMPLEMENTATION_REFERENCE.md`](dev/IMPLEMENTATION_REFERENCE.md) §1）:

- **仮想時刻** `virtualSortMs`（`created_at` + スキ由来ブースト + 自分投稿ブースト − 投稿の攻撃性ペナルティ）を降順。ブースト／ペナルティは **数分相当の上限**。
- 手動検証では **数分以内**に近い時刻で投稿した2件なら、スキや（閾値未満の）高めの攻撃性スコアで **相対順が変わりうる**。

---

## 6. 「スキ」の意味（方針レベル）

- **いいね数を投稿に表示しない**。集計カラムも持たない。
- **「スキ」操作**は、RPC `apply_user_affinity_on_like` 経由で **`user_affinity` 行を更新**し、**閲覧者から見た相手への `like_score`** として蓄積される（双方向に別レコードが動く。詳細はマイグレーション `user_affinity` 定義参照）。
- タイムライン順は上記 **5.2** のとおり、**その閲覧者の視点でのみ** `like_score` が効く。他ユーザーには同じ並びにならない。

---

## 7. 手動検証手順の例（スキと順序）

**目的**: 「同程度の新しさの投稿が2つあるとき、スキを付けた投稿者のほうが、閲覧者のタイムラインで上に来やすいこと」を目視で確認する。

**準備**

- アカウント **A**（閲覧者）と **B**（投稿者）、必要なら **C**（もう1人の投稿者）。
- 両方ログインできるブラウザ（プロファイル分けまたはシークレット＋通常）。

**手順（例）**

1. **B** と **C** が、**できるだけ近い時刻**に短い投稿をそれぞれ1件ずつ投稿する（数分以内が望ましい）。
2. **A** でトップを開き、**スキ前**の並びをメモする（上から B と C のどちらが先か）。
3. **A** だけが **B の投稿に「スキ」** を付ける（C には付けない）。
4. トップを **再読み込み** し、並びが変わるか確認する。  
   - 期待: **近い時刻**の投稿同士では、スキで B 側が相対的に上に来やすくなる（上限付きブースト）。  
   - **かなり古い投稿**は、スキだけでは最上部を無制限に独占しない。

**攻撃性フィルタの確認（別観点）**

- **A** のプロフィールで「表示フィルタ」を厳しめにし、閾値を超えた**他人**の投稿が消え、**自分の投稿**は残ることを確認する（`app/page.tsx` のフィルタ条件）。

---

## 8. 攻撃性テスト用5指標（1行目・2行目）の永続化

**閲覧フィルタは `moderation_max_score` のみ**。5 指標の内訳は **`moderation_dev_scores`（jsonb）** に保存し、Vercel / ローカル / 他ユーザーでも同じ一覧取得で表示できる。

- **1行目**: 投稿・返信 insert 時に `moderation_dev_scores.first` を書く。
- **2行目**: `pending_content` が空かつ **投稿・返信の `created_at` から 15 分後**に、確定本文で `/api/moderate` を叩き、`/api/persist-moderation-dev-scores`（要 `SUPABASE_SERVICE_ROLE_KEY`）で `second` を保存。pending を **サーバーで確定した場合**は `finalize-pending-edits-core` が `second` をマージ。
- **localStorage / IndexedDB** はキャッシュ。IDB 復元が終わるまで空マップを IDB に書かない（表示が一瞬消える対策）。

変更時は `app/page.tsx` / `app/home/page.tsx` の `fetchPosts` / `fetchOwnPosts` の DB マージ、`persist-moderation-dev-scores`、second-moderation `useEffect`、`lib/pending-second-moderation.ts` を参照する。

---

## 9. 関連ファイル（変更時のチェックリスト）

| 内容 | 主なファイル |
|------|----------------|
| 実装要約（数式・閾値の一覧） | `docs/dev/IMPLEMENTATION_REFERENCE.md` |
| タイムライン取得・フィルタ・ソート | `app/page.tsx`（`fetchPosts`） |
| タイムライン並び（仮想時刻＋スキ＋攻撃性ペナルティ） | `lib/timeline-sort.ts` |
| 閾値・ノイズフロア | `lib/toxicity-filter-level.ts` |
| スキ RPC | `supabase/migrations/` 内 `user_affinity` / `apply_user_affinity_on_like` |
| 5指標の DB 保存・2行目・キャッシュ | `lib/moderation-dev-scores-db.ts`, `app/api/persist-moderation-dev-scores/route.ts`, `lib/moderation-scores-indexeddb.ts`, `lib/second-moderation-timing.ts`, `lib/pending-second-moderation.ts` |
| E2E 設定・サンプル | `playwright.config.ts`, `e2e/smoke.spec.ts` |

設計思想の文章面は `docs/PRODUCT_PRINCIPLES.md` や `docs/INVITE_OVERVIEW.md` と突き合わせる。
