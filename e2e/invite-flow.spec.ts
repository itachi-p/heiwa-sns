import { test, expect } from "@playwright/test";

/**
 * 先行体験「3番」相当: **貸与済みのメール＋パスワードでログイン** →（必要なら招待コード・初回パス変更・ニックネーム）→ トップで初投稿。
 *
 * 必須:
 *   E2E_LOGIN_EMAIL / E2E_LOGIN_PASSWORD … 事前に用意したテストユーザ（例: user02@test.com）
 *
 * 任意:
 *   INVITE_CODE … `invite_onboarding_completed` が未のユーザ向け（`InviteOnboardingLayer`）
 *   E2E_FIRST_LOGIN_NEW_PASSWORD … `must_change_password` のとき初回変更に使う（8文字以上・英字+数字）
 *
 * 例:
 *   E2E_LOGIN_EMAIL=user02@test.com E2E_LOGIN_PASSWORD=user02ps npm run test:e2e -- e2e/invite-flow.spec.ts
 */
const loginEmail = (process.env.E2E_LOGIN_EMAIL ?? "").trim();
const loginPassword = (process.env.E2E_LOGIN_PASSWORD ?? "").trim();

test.skip(
  !loginEmail || !loginPassword,
  "E2E_LOGIN_EMAIL と E2E_LOGIN_PASSWORD を設定してから実行してください（貸与アカウント）。"
);

test("lent user: login → optional gates → first post on timeline", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const random = Math.floor(Math.random() * 1_000_000);
  const nickname = `e2eu${random}`;
  const postBody = `E2E lent-user ${random}`;

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

  await expect(nicknameHeading.or(composeTrigger)).toBeVisible({
    timeout: 60_000,
  });

  if (await nicknameHeading.isVisible()) {
    await page.getByPlaceholder("ニックネーム").fill(nickname);
    await page.getByRole("button", { name: "保存してはじめる" }).click();
    await expect(nicknameHeading).toBeHidden({ timeout: 30_000 });
  }

  await expect(composeTrigger).toBeVisible({ timeout: 30_000 });
  await composeTrigger.click();
  await page.getByPlaceholder("いまどうしてる？").fill(postBody);
  await page.getByRole("button", { name: "投稿", exact: true }).click();

  await expect(page.getByText(postBody, { exact: true })).toBeVisible({
    timeout: 60_000,
  });
});
