import { test, expect } from "@playwright/test";
import { loadEnvLocal } from "./load-env-local";
import { resetLentInviteUserAfterE2e } from "./reset-lent-invite-user";

loadEnvLocal();

test.afterEach(async () => {
  await resetLentInviteUserAfterE2e();
});

/**
 * 先行体験「3番」相当: **貸与済みのメール＋パスワードでログイン** →（必要なら招待コード・初回パス変更・ニックネーム）→ トップで初投稿。
 *
 * **本体の前提（ここが満たされないと DB も変わらずモーダルも出ない）**
 * - **招待トークン**（`invite_tokens.is_used`）は **`POST /api/invite-bind` か `POST /api/invite-signup` が成功したときだけ**消費される。`InviteOnboardingLayer` は **`users.invite_onboarding_completed === false`** のときだけ出る（`components/invite-onboarding-layer.tsx`）。マイグレで既存ユーザは一括 `true` 済みのため、貸与ダミーがそのままなら招待モーダルは出ず、トークンも触られない。
 * - **ニックネーム強制**は **`users.nickname` が null / 空 / 空白のみ**のときの `NicknameRequiredModal` のみ（`needsNickname` in `app/(main)/page.tsx`）。**既にニックネームがあるユーザを「変更させる」専用ゲートは無い**（運用で `nickname` を空にする等が必要）。
 *
 * 必須:
 *   E2E_LOGIN_EMAIL / E2E_LOGIN_PASSWORD … 事前に用意したテストユーザ（例: user02@test.com）
 *
 * 任意:
 *   INVITE_CODE … `invite_onboarding_completed` が未のユーザ向け（`InviteOnboardingLayer`）。teardown で **同一トークン行を未使用に戻す**（次回も同じコードで可）。
 *   E2E_FIRST_LOGIN_NEW_PASSWORD … `must_change_password` のとき初回変更に使う（8文字以上・英字+数字）
 *   `SUPABASE_SERVICE_ROLE_KEY` … **各テストの後**に貸与状態へ戻す teardown 用（`filtering.spec.ts` と同様。無い場合は teardown をスキップ）。
 *   `E2E_LENT_TEARDOWN=0` … 貸与状態への自動復帰を無効化（デバッグ用。既定はオン扱い）。
 *
 * `.env.local` に上記キーを書いてもよい（`e2e/load-env-local.ts` が未設定のキーのみ注入。シェルで既に export している値は上書きしない）。
 *
 * 例（シェルで上書きする場合）:
 *   E2E_LOGIN_EMAIL=user02@test.com E2E_LOGIN_PASSWORD=user02ps npm run test:e2e -- e2e/invite-flow.spec.ts
 */
const loginEmail = (process.env.E2E_LOGIN_EMAIL ?? "").trim();
const loginPassword = (process.env.E2E_LOGIN_PASSWORD ?? "").trim();

test.skip(
  !loginEmail || !loginPassword,
  "E2E_LOGIN_EMAIL と E2E_LOGIN_PASSWORD を設定してから実行してください（貸与アカウント）。"
);

/** 画面上で自然人名に見える例（末尾に短い連番を付けて `users_nickname_unique_ci` と衝突しにくくする） */
const E2E_NICKNAME_BASES = [
  "田中健",
  "佐藤美咲",
  "鈴木拓也",
  "高橋結菜",
  "伊藤大輔",
  "渡辺凛",
] as const;

test("lent user: login → optional gates → first post on timeline", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const base =
    E2E_NICKNAME_BASES[Math.floor(Date.now() / 1000) % E2E_NICKNAME_BASES.length];
  const seq = String(Date.now() % 10_000).padStart(4, "0");
  const nickname = `${base}${seq}`.slice(0, 20);
  const postBody = `先行E2Eの確認です。${nickname}として投稿しています。`;

  const loginModalHeading = page.getByRole("heading", {
    name: "ログイン・新規登録",
  });
  const nicknameHeading = page.getByRole("heading", {
    name: "ニックネームを設定",
  });
  const passwordChangeHeading = page.getByRole("heading", {
    name: "パスワードを変更",
  });
  const inviteHeading = page.getByRole("heading", {
    name: "招待コードを入力",
  });
  const composeTrigger = page.getByRole("button", { name: "投稿を書く" });
  /** `canInteract` が false の間は compose フォームは出ない。+ ボタンだけでは or 待機に使えない */
  const composeBody = page.getByPlaceholder("いまどうしてる？");

  await page.goto("/");

  await expect(
    page.getByRole("button", { name: "ログイン・新規登録" })
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "ログイン・新規登録" }).click();
  await expect(loginModalHeading).toBeVisible();

  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  await page.getByPlaceholder("email@example.com").fill(loginEmail);
  await page.getByPlaceholder("パスワード").fill(loginPassword);
  await page.getByRole("button", { name: "メールでログイン" }).click();

  await expect(loginModalHeading).toBeHidden({ timeout: 90_000 });

  // 初回パスワード変更（must_change_password）
  try {
    await passwordChangeHeading.waitFor({ state: "visible", timeout: 12_000 });
  } catch {
    /* 出ない場合はスキップ */
  }
  if (await passwordChangeHeading.isVisible()) {
    const newPw = (process.env.E2E_FIRST_LOGIN_NEW_PASSWORD ?? "").trim();
    test.skip(
      !newPw,
      "must_change_password のユーザです。E2E_FIRST_LOGIN_NEW_PASSWORD（8文字以上・英字と数字）を設定するか、手動で一度パスワード変更してください。"
    );
    await page.getByPlaceholder("新しいパスワード").fill(newPw);
    await page.getByPlaceholder("確認用").fill(newPw);
    await page.getByRole("button", { name: "保存して続ける" }).click();
    await expect(passwordChangeHeading).toBeHidden({ timeout: 45_000 });
  }

  // 招待コード未紐付け（OAuth 初回などと同じレイヤー）
  try {
    await inviteHeading.waitFor({ state: "visible", timeout: 12_000 });
  } catch {
    /* */
  }
  if (await inviteHeading.isVisible()) {
    const code = (process.env.INVITE_CODE ?? "").trim();
    test.skip(
      !code,
      "招待未完了のユーザです。未使用の INVITE_CODE を設定するか、SQL で invite_onboarding_completed を済ませてください。"
    );
    await page.getByPlaceholder("招待コード").fill(code);
    await page.getByRole("button", { name: "登録する" }).click();
    await expect(inviteHeading).toBeHidden({ timeout: 45_000 });
  }

  try {
    await nicknameHeading.waitFor({ state: "visible", timeout: 60_000 });
  } catch {
    /* ニックネーム未設定でないアカウント（貸与 SQL 未実施など） */
  }

  if (await nicknameHeading.isVisible()) {
    await page
      .getByRole("dialog", { name: "ニックネームを設定" })
      .getByPlaceholder("ニックネーム")
      .fill(nickname);
    await page.getByRole("button", { name: "保存してはじめる" }).click();
    await expect(nicknameHeading).toBeHidden({ timeout: 30_000 });
  }

  await expect(composeTrigger).toBeVisible({ timeout: 30_000 });
  await composeTrigger.click();
  await expect(composeBody).toBeVisible({ timeout: 30_000 });
  await composeBody.fill(postBody);
  await page.getByRole("button", { name: "投稿", exact: true }).click();

  await expect(page.getByText(postBody, { exact: true })).toBeVisible({
    timeout: 60_000,
  });
});
