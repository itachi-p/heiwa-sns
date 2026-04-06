import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import {
  effectiveScoreForViewerToxicityFilter,
  TOXICITY_THRESHOLDS,
} from "../lib/toxicity-filter-level";

/**
 * .env.local から KEY=VALUE を process.env に読み込む（未定義のときのみ）。
 * Playwright は Next の .env を自動では読まない。
 */
function loadEnvLocal(): void {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  const text = readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvLocal();

const u1 = process.env.TEST_USER1_EMAIL;
const p1 = process.env.TEST_USER1_PASSWORD;
const u2 = process.env.TEST_USER2_EMAIL;
const p2 = process.env.TEST_USER2_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** users.toxicity_filter_level の値（TOXICITY_THRESHOLDS と対応） */
type FilterLevel = "strict" | "soft" | "normal" | "off";

/**
 * 閾値帯ごとに 1 件ずつ `moderation_max_score` を固定（API 採点は使わない）。
 * `TOXICITY_THRESHOLDS`: strict 0.3 / soft 0.5 / normal 0.7。ノイズフロア 0.2 以下は有効スコア 0。
 */
const TIERS = [
  {
    key: "S015",
    /** 0.2 以下 → 有効 0 → どの段階でも表示 */
    moderation_max_score: 0.15,
    body: "穏やかな一日でした。",
  },
  {
    key: "S035",
    /** 有効 0.35 → 厳しめ(0.3)のみ非表示 */
    moderation_max_score: 0.35,
    body: "境界付近の表現（スコアは DB で固定）。",
  },
  {
    key: "S055",
    /** 有効 0.55 → 厳しめ・やや厳しめで非表示、標準では表示 */
    moderation_max_score: 0.55,
    body: "中程度の攻撃的表現（スコアは DB で固定）。",
  },
  {
    key: "S075",
    /** 有効 0.75 → off 以外は非表示 */
    moderation_max_score: 0.75,
    body: "強い攻撃的表現（スコアは DB で固定）。",
  },
] as const;

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

/** プロフィール編集モーダル内の「表示フィルタ」用 select */
function toxicityFilterSelect(page: Page) {
  return page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "プロフィール編集" }) })
    .locator("select")
    .first();
}

async function openProfileEdit(page: Page) {
  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: "あなたの投稿（新しい順）" })
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "プロフィールを編集" }).click();
  await expect(
    page.getByRole("heading", { name: "プロフィール編集" })
  ).toBeVisible();
}

async function saveProfileAndClose(page: Page): Promise<void> {
  const form = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "プロフィール編集" }) });
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "プロフィール編集" })
  ).not.toBeVisible({ timeout: 30_000 });
}

async function setToxicityFilter(page: Page, level: FilterLevel): Promise<void> {
  await openProfileEdit(page);
  await toxicityFilterSelect(page).selectOption(level);
  await saveProfileAndClose(page);
}

/** main 内にマーカー文字列を含む投稿カードがあるか */
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

/** 投稿本文の一意マーカーで `moderation_max_score` を上書き（E2E 用） */
async function patchModerationScoresByMarkers(
  admin: SupabaseClient,
  runId: string,
  tiers: readonly { key: string; moderation_max_score: number }[]
): Promise<void> {
  for (const t of tiers) {
    /** `[]` は PostgreSQL の ILIKE パターンと衝突するためマーカーに含めない */
    const marker = `E2E-FILTER-${runId}-${t.key}`;
    const { error } = await admin
      .from("posts")
      .update({ moderation_max_score: t.moderation_max_score })
      .ilike("content", `%${marker}%`);
    if (error) throw new Error(`${marker}: ${error.message}`);
  }
}

/** effectiveScore > threshold なら非表示（`app/page.tsx` の閲覧ロジックと同じ変換） */
function expectHiddenAtLevel(
  level: FilterLevel,
  moderationMax: number
): boolean {
  const eff = effectiveScoreForViewerToxicityFilter(moderationMax);
  return eff > TOXICITY_THRESHOLDS[level];
}

test.describe.configure({ mode: "serial" });

test.describe("閲覧フィルタ強度とタイムライン表示", () => {
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
      const openCompose = page.getByRole("button", {
        name: "投稿フォームを開く",
      });

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

    await test.step("TEST_USER2: ログアウト", async () => {
      await logout(page);
    });
  });
});
