import { expect, test } from "@playwright/test";
import {
  affinitySortContribution,
  compareTimelinePosts,
  computeTimelineVirtualSortMs,
  moderationTimePenaltyMs,
  sortTimelinePosts,
  TIMELINE_AFFINITY_MAX_BOOST_MS,
  TIMELINE_TOXICITY_MAX_PENALTY_MS,
  toxicitySortSoftFactor,
} from "../lib/timeline-sort";

/**
 * `lib/timeline-sort.ts` の仮想時刻並び（スキ・関係ペナルティ・投稿の攻撃性）。
 * 実装の要約は `docs/dev/IMPLEMENTATION_REFERENCE.md` §1.2。
 */

const VIEWER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function post(
  id: number,
  authorId: string,
  createdMs: number,
  moderationMaxScore?: number | null
): {
  id: number;
  user_id: string;
  created_at: string;
  moderation_max_score?: number | null;
} {
  return {
    id,
    user_id: authorId,
    created_at: new Date(createdMs).toISOString(),
    moderation_max_score:
      moderationMaxScore === undefined ? null : moderationMaxScore,
  };
}

test.describe("timeline-sort（仮想時刻 = 新しさ + スキ − 攻撃性）", () => {
  test("十分に新しい投稿は、古い方に最大スキが付いていても上に来る", () => {
    const tOld = 1_700_000_000_000;
    const tNew = tOld + 12 * 60 * 1000;
    const older = post(1, "star", tOld);
    const newer = post(2, "plain", tNew);
    const aff = new Map<string, number>([["star", 1_000_000]]);
    const rel = new Map<string, number>();
    const sorted = sortTimelinePosts([older, newer], VIEWER, aff, rel);
    expect(sorted[0]!.id).toBe(2);
  });

  test("近い時刻ではスキが多い作者の投稿が上に来うる", () => {
    const t = 1_700_000_000_000;
    const lowSuki = post(1, "u-low", t);
    const highSuki = post(2, "u-high", t);
    const aff = new Map<string, number>([
      ["u-low", 1],
      ["u-high", 80],
    ]);
    const sorted = sortTimelinePosts([lowSuki, highSuki], VIEWER, aff, emptyRel());
    expect(sorted[0]!.user_id).toBe("u-high");
  });

  test("同時刻・同程度のスキなら、moderation が高い他人投稿は下がる（表示は別ロジック）", () => {
    const t = 1_700_000_000_000;
    const clean = post(1, "a", t, 0.1);
    const harsh = post(2, "b", t, 0.85);
    const aff = new Map<string, number>([
      ["a", 10],
      ["b", 10],
    ]);
    const sorted = sortTimelinePosts([clean, harsh], VIEWER, aff, emptyRel());
    expect(sorted[0]!.id).toBe(1);
    expect(
      moderationTimePenaltyMs(0.85, false)
    ).toBeGreaterThan(0);
  });

  test("reply_toxic_events 由来の relation が低いとスキブーストが弱まる", () => {
    const t = 1_700_000_000_000;
    const penalized = post(1, "actor-hot", t);
    const clean = post(2, "actor-ok", t);
    const aff = new Map<string, number>([
      ["actor-hot", 40],
      ["actor-ok", 40],
    ]);
    const rel = new Map<string, number>([
      ["actor-hot", 0.65],
      ["actor-ok", 1],
    ]);
    const sorted = sortTimelinePosts([penalized, clean], VIEWER, aff, rel);
    expect(sorted[0]!.id).toBe(2);
  });

  test("閲覧者本人の投稿は攻撃性ペナルティなし＋微ブーストで上になりうる", () => {
    const t = 1_700_000_000_000;
    const mine = post(1, VIEWER, t, 0.9);
    const other = post(2, "other", t, 0.1);
    const aff = new Map<string, number>([["other", 0]]);
    const sorted = sortTimelinePosts([mine, other], VIEWER, aff, emptyRel());
    expect(sorted[0]!.id).toBe(1);
  });

  test("仮想時刻が等しければ id 降順", () => {
    const t = 1_700_000_000_000;
    const a = post(10, "u1", t, 0.1);
    const b = post(20, "u2", t, 0.1);
    const aff = new Map<string, number>([
      ["u1", 5],
      ["u2", 5],
    ]);
    const sorted = sortTimelinePosts([a, b], VIEWER, aff, emptyRel());
    expect(sorted.map((p) => p.id)).toEqual([20, 10]);
  });

  test("多数作者でも compare が隣接ペアで整合", () => {
    const t = 1_700_000_000_000;
    const authors = ["a", "b", "c", "d", "e"];
    const posts = authors.map((uid, i) =>
      post(i + 1, uid, t, 0.15 + i * 0.01)
    );
    const aff = new Map<string, number>([
      ["a", 0],
      ["b", 40],
      ["c", 10],
      ["d", 25],
      ["e", 5],
    ]);
    const rel = new Map<string, number>([
      ["a", 1],
      ["b", 0.55],
      ["c", 1],
      ["d", 0.7],
      ["e", 1],
    ]);
    const sorted = sortTimelinePosts(posts, VIEWER, aff, rel);
    for (let i = 0; i < sorted.length - 1; i++) {
      const cmp = compareTimelinePosts(
        sorted[i]!,
        sorted[i + 1]!,
        VIEWER,
        aff,
        rel
      );
      expect(cmp).toBeLessThanOrEqual(0);
    }
  });

  test("computeTimelineVirtualSortMs はブースト・ペナルティの合成が線形に追える", () => {
    const t = 1_700_000_000_000;
    const p = post(1, "x", t, 0.5);
    const aff = new Map([["x", 0]]);
    const rel = new Map<string, number>();
    const v0 = computeTimelineVirtualSortMs(p, VIEWER, aff, rel);
    const v1 = computeTimelineVirtualSortMs(
      post(1, "x", t, 0),
      VIEWER,
      aff,
      rel
    );
    expect(v1 - v0).toBeCloseTo(
      0.5 * TIMELINE_TOXICITY_MAX_PENALTY_MS,
      -2
    );
  });
});

test.describe("timeline-sort 補助関数の境界", () => {
  test("affinitySortContribution は対数飽和", () => {
    const huge = affinitySortContribution(1e15);
    expect(huge).toBeLessThanOrEqual(0.08);
  });

  test("toxicitySortSoftFactor: multiplier>=1 は 1", () => {
    expect(toxicitySortSoftFactor(1)).toBe(1);
  });

  test("スキブースト ms は上限以下", () => {
    const t = 1_700_000_000_000;
    const p = post(1, "z", t);
    const aff = new Map([["z", Number.MAX_SAFE_INTEGER]]);
    const v = computeTimelineVirtualSortMs(p, VIEWER, aff, emptyRel());
    expect(v - t).toBeLessThanOrEqual(
      TIMELINE_AFFINITY_MAX_BOOST_MS + TIMELINE_TOXICITY_MAX_PENALTY_MS
    );
  });
});

function emptyRel(): Map<string, number> {
  return new Map();
}
