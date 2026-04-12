import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import {
  effectiveScoreForViewerToxicityFilter,
  TOXICITY_THRESHOLDS,
} from "../lib/toxicity-filter-level";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();

const u1 = process.env.TEST_USER1_EMAIL;
const p1 = process.env.TEST_USER1_PASSWORD;
const u2 = process.env.TEST_USER2_EMAIL;
const p2 = process.env.TEST_USER2_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

type FilterLevel = "strict" | "soft" | "normal" | "off";
type OverThresholdBehavior = "hide" | "fold";

const TIERS = [
  {
    key: "S016",
    moderation_max_score: 0.16,
    body: "Fラン大卒じゃその程度しか考えられんか",
  },
  {
    key: "S457",
    moderation_max_score: 0.457,
    body: "バカみたいだね",
  },
  {
    key: "S568",
    moderation_max_score: 0.568,
    body: "頭悪くないか君",
  },
  {
    key: "S765",
    moderation_max_score: 0.765,
    body: "お前は死ね、消えろ、最低のクズだ。二度と顔を見せるな。",
  },
] as const;

const LEVEL_RANGE: Record<FilterLevel, string> = {
  strict: "0",
  soft: "1",
  normal: "2",
  off: "3",
};

async function loginEmailPassword(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "ログイン・新規登録" }).click();
  await page.getByPlaceholder("email@example.com").fill(email);
  await page.getByPlaceholder("パスワード").fill(password);
  await page.getByRole("button", { name: "メールでログイン" }).click();
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible({
    timeout: 60_000,
  });
}

async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(
    page.getByRole("button", { name: "ログイン・新規登録" })
  ).toBeVisible({ timeout: 15_000 });
}

async function openToxicitySettingsModal(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
  await page
    .getByRole("navigation", { name: "メイン" })
    .getByRole("button", { name: "可視性" })
    .click();
  await expect(page.getByRole("dialog", { name: "閲覧フィルタ" })).toBeVisible();
}

async function setToxicityFilter(page: Page, level: FilterLevel): Promise<void> {
  await openToxicitySettingsModal(page);
  const dialog = page.getByRole("dialog", { name: "閲覧フィルタ" });
  await dialog.locator('input[type="range"]').fill(LEVEL_RANGE[level]);
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
}

async function setOverThresholdBehavior(
  page: Page,
  behavior: OverThresholdBehavior
): Promise<void> {
  await openToxicitySettingsModal(page);
  const dialog = page.getByRole("dialog", { name: "閲覧フィルタ" });
  const sw = dialog.getByRole("switch");
  const wantFold = behavior === "fold";
  for (let i = 0; i < 3; i++) {
    const checked = (await sw.getAttribute("aria-checked")) === "true";
    if (checked === wantFold) break;
    await sw.click();
  }
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
}

async function postWithMarkerVisible(page: Page, marker: string): Promise<boolean> {
  const main = page.locator("main");
  const hit = main.getByText(marker, { exact: false });
  return (await hit.count()) > 0;
}

function createAdminClient(): SupabaseClient | null {
  if (!supabaseUrl || !serviceRole) return null;
  return createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function patchModerationScoresByMarkers(
  admin: SupabaseClient,
  runId: string,
  tiers: readonly { key: string; moderation_max_score: number }[]
): Promise<void> {
  for (const t of tiers) {
    const marker = `E2E-FILTER-${runId}-${t.key}`;
    const { error } = await admin
      .from("posts")
      .update({ moderation_max_score: t.moderation_max_score })
      .ilike("content", `%${marker}%`);
    if (error) throw new Error(`${marker}: ${error.message}`);
  }
}

function expectHiddenAtLevel(
  level: FilterLevel,
  moderationMax: number
): boolean {
  const eff = effectiveScoreForViewerToxicityFilter(moderationMax);
  return eff > TOXICITY_THRESHOLDS[level];
}

test.describe.configure({ mode: "serial" });

test.describe("タイムライン閲覧フィルタ（帯・折りたたみ）", () => {
  test.skip(
    !u1 || !p1 || !u2 || !p2,
    "TEST_USER1_EMAIL / TEST_USER1_PASSWORD / TEST_USER2_EMAIL / TEST_USER2_PASSWORD を .env.local に設定してください。"
  );

  test("TEST_USER1 が4件投稿→スコア固定、TEST_USER2 の各フィルタで表示が帯どおり変わる", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    const admin = createAdminClient();
    test.skip(
      !admin,
      "NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です（投稿の moderation_max_score を帯どおりに固定するため）。"
    );

    const runId = `f${Date.now().toString(36)}`;

    const markers = TIERS.map((t) => `E2E-FILTER-${runId}-${t.key}` as string);

    await test.step("TEST_USER1: タイムラインで4投稿", async () => {
      await loginEmailPassword(page, u1!, p1!);

      const composeInput = page.getByPlaceholder("いまどうしてる？");
      const openCompose = page.getByRole("button", { name: "投稿を書く" });

      for (const tier of TIERS) {
        const marker = `E2E-FILTER-${runId}-${tier.key}`;
        const body = `${marker} ${tier.body}`;
        if (!(await composeInput.isVisible())) {
          await openCompose.click();
        }
        await expect(composeInput).toBeVisible({ timeout: 10_000 });
        await composeInput.fill(body);
        await page.getByRole("button", { name: "投稿", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "投稿中…" })
        ).not.toBeVisible({
          timeout: 120_000,
        });
        await page.waitForTimeout(800);
      }

      await patchModerationScoresByMarkers(admin!, runId, TIERS);

      await logout(page);
    });

    await test.step("TEST_USER2: ログイン", async () => {
      await loginEmailPassword(page, u2!, p2!);
    });

    await test.step("TEST_USER2: デフォルト動作として閾値超=非表示を選択", async () => {
      await setOverThresholdBehavior(page, "hide");
    });

    const levels: FilterLevel[] = ["strict", "soft", "normal", "off"];

    for (const level of levels) {
      await test.step(
        `TEST_USER2: 表示フィルタ「${level}」→ 各マーカーの表示を帯どおり確認`,
        async () => {
          await setToxicityFilter(page, level);
          await page.goto("/");
          await expect(page.locator("main")).toBeVisible();

          for (let i = 0; i < TIERS.length; i++) {
            const tier = TIERS[i]!;
            const hidden = expectHiddenAtLevel(level, tier.moderation_max_score);
            await expect
              .poll(
                async () => postWithMarkerVisible(page, markers[i]!),
                { timeout: 45_000, intervals: [500, 1000, 2000] }
              )
              .toBe(!hidden);
          }
        }
      );
    }

    await test.step(
      "TEST_USER2: 閾値超=折りたたみで制限カードが出て、展開すると本文が見える",
      async () => {
        await setToxicityFilter(page, "strict");
        await setOverThresholdBehavior(page, "fold");
        await page.goto("/");
        await expect(page.locator("main")).toBeVisible();

        const severeMarker = markers[3]!;
        await expect
          .poll(async () => postWithMarkerVisible(page, severeMarker), {
            timeout: 45_000,
            intervals: [500, 1000, 2000],
          })
          .toBe(false);

        await page
          .getByRole("button", { name: "表示制限中（タップで展開）" })
          .first()
          .click();

        await expect
          .poll(async () => postWithMarkerVisible(page, severeMarker), {
            timeout: 30_000,
            intervals: [500, 1000],
          })
          .toBe(true);
      }
    );

    await test.step("TEST_USER2: ログアウト", async () => {
      await logout(page);
    });
  });
});
