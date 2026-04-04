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

**Supabase / ログインが必要なシナリオ**を E2E に書く場合は、`.env.local` の有無・テスト用アカウント・CI のシークレットなどを別途設計する（現状の `e2e/smoke.spec.ts` は未ログインのトップ表示のみ）。

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

**要点のみ**（定数・式・`reply_toxic_events` の扱いはすべて [`dev/IMPLEMENTATION_REFERENCE.md`](dev/IMPLEMENTATION_REFERENCE.md) §1）:

- **主軸は `created_at`（ミリ秒）**: 新しい投稿が常に上。スキ由来の二次スコアは **同一タイムスタンプのタイブレーク**にのみ効く。
- 手動検証「数分以内の2投稿でスキが効く」は、**DB 上 `created_at` が同一 ms** のときに限り相対順が変わる可能性がある（通常は時刻差で決まる）。

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
   - 期待: **同一 5 分スロット内**では B の投稿が相対的に上に来やすくなる（二次スコアの差）。  
   - **スロットをまたいだ古い投稿**は、スキだけでは新しいスロットより上に来ない。

**攻撃性フィルタの確認（別観点）**

- **A** のプロフィールで「表示フィルタ」を厳しめにし、閾値を超えた**他人**の投稿が消え、**自分の投稿**は残ることを確認する（`app/page.tsx` のフィルタ条件）。

---

## 8. 攻撃性テスト用5指標（1行目・2行目）のクライアント永続化

**DB には max のみ**（`moderation_max_score`）。5指標の内訳は **DB 列を増やさず**、ブラウザ側で保持する。

- **localStorage**（既存）に加え **IndexedDB**（`lib/moderation-scores-indexeddb.ts`）へも同一マップを保存し、再読み込み後も欠損しにくくする。
- **1行目**: 投稿・返信送信時に `/api/moderate` の結果を state に載せ、上記ストレージへ同期。
- **2行目**: 本文が編集窓内で確定したあと（`pending_content` が空）、かつ **投稿の `created_at` から 15 分経過後**（`lib/second-moderation-timing.ts`・`POST_EDIT_WINDOW_MS`）に、確定本文でもう一度 `/api/moderate` を叩いて埋める。新規投稿も `markPostNeedsSecondModeration` でキューに載せ、15 分後に同じ処理が走る。
- 2行目を state にマージするときは **既存の 1 行目オブジェクトを潰さない**（`{ ...row, second }`）。

変更時は `app/page.tsx` / `app/home/page.tsx` の second-moderation `useEffect`（依存に `nowTick` を含む）と `lib/pending-second-moderation.ts` を参照する。

---

## 9. 関連ファイル（変更時のチェックリスト）

| 内容 | 主なファイル |
|------|----------------|
| 実装要約（数式・閾値の一覧） | `docs/dev/IMPLEMENTATION_REFERENCE.md` |
| タイムライン取得・フィルタ・ソート | `app/page.tsx`（`fetchPosts`） |
| タイムライン並び（スロット＋二次スコア） | `lib/timeline-sort.ts` |
| 閾値・ノイズフロア | `lib/toxicity-filter-level.ts` |
| スキ RPC | `supabase/migrations/` 内 `user_affinity` / `apply_user_affinity_on_like` |
| 5指標のクライアント保存・2行目タイミング | `lib/moderation-scores-indexeddb.ts`, `lib/second-moderation-timing.ts`, `lib/pending-second-moderation.ts` |
| E2E 設定・サンプル | `playwright.config.ts`, `e2e/smoke.spec.ts` |

設計思想の文章面は `docs/PRODUCT_PRINCIPLES.md` や `docs/INVITE_OVERVIEW.md` と突き合わせる。
