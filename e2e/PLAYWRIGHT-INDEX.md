# Playwright E2E 索引（`e2e/`）

**リポジトリルートの [`README.md`](../README.md) や [`docs/INDEX.md`](../docs/INDEX.md) とは別**です。スペックファイルの一覧と実行上の注意だけを載せます。

| ファイル | 種別 | 内容 |
|----------|------|------|
| `unit-timeline-sort.spec.ts` | **純関数** | `lib/timeline-sort.ts`。**DB・ログインなし**（Playwright で Node 実行しているだけ） |
| `timeline-toxicity-filter.spec.ts` | ブラウザ + **service_role** | 2 ユーザで投稿→`posts.moderation_max_score` を API で上書き→閲覧フィルタの帯・折りたたみ。`.env.local` に **`TEST_USER1_EMAIL` / `TEST_USER1_PASSWORD` / `TEST_USER2_EMAIL` / `TEST_USER2_PASSWORD`** と **`SUPABASE_SERVICE_ROLE_KEY`** が必要（役割は `docs/dev/TEST_USER_ROLES.md`） |
| `invite-flow.spec.ts` | ブラウザ + teardown | 貸与ユーザ（`E2E_LOGIN_EMAIL` 等）。`e2e/reset-lent-invite-user.ts` |

**注意:** `timeline-toxicity-filter` は **本物の `posts` 行を更新**する。スキーマや RLS とズレた service_role クライアントを使うと失敗する。不要なときは **`npm run test:e2e -- e2e/unit-timeline-sort.spec.ts`** のようにファイルを絞る。
