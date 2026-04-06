/**
 * タイムライン並び（`app/page.tsx` のみ使用）。
 *
 * **仮想時刻** `virtualSortMs` を降順に並べる:
 *   `created_at` + スキ由来ブースト + 自分投稿ブースト − 投稿の攻撃性スコア由来ペナルティ
 *
 * 新しさが主軸だが、**数分以内**の差であればスキで上がり・高毒性で下がりうる（無制限に古い投稿が
 * 最上部を独占しないようブースト／ペナルティはミリ秒上限でキャップ）。
 */

import { effectiveScoreForViewerToxicityFilter } from "@/lib/toxicity-filter-level";

/** スキ由来で `created_at` に足せる最大（ms）。`affinitySortContribution` の飽和をこの幅に線形対応 */
export const TIMELINE_AFFINITY_MAX_BOOST_MS = 3 * 60 * 1000;

/** 他人投稿の `effectiveScore`（0〜1）に応じて `created_at` から引く最大（ms） */
export const TIMELINE_TOXICITY_MAX_PENALTY_MS = 5 * 60 * 1000;

/** 閲覧者本人の投稿にだけ足す微ブースト（ms） */
export const TIMELINE_OWN_POST_BOOST_MS = 60 * 1000;

/** 互換・文書用。並びには直接使わない */
export const TIMELINE_SORT_SLOT_MS = 5 * 60 * 1000;

/** @deprecated 旧「同一作者連続緩和」用。現在の並びでは未使用。 */
export const TIMELINE_MAX_CONSECUTIVE_SAME_AUTHOR = 2;

/**
 * 「スキ」由来の加点（0〜0.08、対数飽和）。ブースト ms への換算の素に使う。
 */
export function affinitySortContribution(likeScore: number): number {
  const s = Number.isFinite(likeScore) ? Math.max(0, likeScore) : 0;
  return Math.min(0.08, Math.log1p(s) * 0.012);
}

/**
 * reply_toxic_events 由来の乗数（0.5〜0.8 付近）を、スキ側ブーストに掛ける弱い減衰。
 */
export function toxicitySortSoftFactor(relationMultiplier: number): number {
  const m = Number.isFinite(relationMultiplier) ? relationMultiplier : 1;
  if (m >= 1) return 1;
  const u = (m - 0.5) / 0.3;
  const x = Math.max(0, Math.min(1, u));
  return 0.97 + 0.03 * x;
}

function createdMs(post: { created_at?: string | null }): number {
  if (!post.created_at) return 0;
  const t = new Date(post.created_at).getTime();
  return Number.isFinite(t) ? t : 0;
}

function sameUser(a: string | undefined, b: string | undefined): boolean {
  if (a == null || b == null) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * 閲覧者→作者のスキと関係ペナルティから、仮想時刻に足す ms（0〜TIMELINE_AFFINITY_MAX_BOOST_MS 付近）。
 */
export function affinityTimeBoostMs(
  likeScore: number,
  relationMultiplier: number
): number {
  const dim =
    affinitySortContribution(likeScore) * toxicitySortSoftFactor(relationMultiplier);
  return (dim / 0.08) * TIMELINE_AFFINITY_MAX_BOOST_MS;
}

/**
 * 投稿のモデレーション攻撃性（閲覧比較用に変換した有効スコア）に応じて仮想時刻から引く ms。
 * 自分の投稿にはペナルティを付けない（表示はフィルタ済みでも順位だけ沈めない）。
 */
export function moderationTimePenaltyMs(
  moderationMaxScore: number | null | undefined,
  isOwnPost: boolean
): number {
  if (isOwnPost) return 0;
  const eff = effectiveScoreForViewerToxicityFilter(moderationMaxScore);
  return eff * TIMELINE_TOXICITY_MAX_PENALTY_MS;
}

/**
 * 並び替えキー（大きいほどタイムライン上で上）。同一値のときは `id` 降順で安定化。
 */
export function computeTimelineVirtualSortMs(
  post: {
    user_id?: string;
    created_at?: string | null;
    id?: number;
    moderation_max_score?: number | null;
  },
  viewerUserId: string | null,
  affinityByAuthor: Map<string, number>,
  relationMultiplierByAuthor: Map<string, number>
): number {
  const cm = createdMs(post);
  const uid = post.user_id;
  const like = uid ? affinityByAuthor.get(uid) ?? 0 : 0;
  const rel = uid ? relationMultiplierByAuthor.get(uid) ?? 1 : 1;
  const boost = affinityTimeBoostMs(like, rel);
  const isOwn = Boolean(viewerUserId && sameUser(uid, viewerUserId));
  const own = isOwn ? TIMELINE_OWN_POST_BOOST_MS : 0;
  const penalty = moderationTimePenaltyMs(post.moderation_max_score, isOwn);
  return cm + boost + own - penalty;
}

/**
 * @deprecated 旧 5 分スロット用。現在は `sortTimelinePosts` で呼ばない。
 */
export function softenSameAuthorStreaks<
  T extends { user_id?: string; created_at?: string | null },
>(posts: T[]): T[] {
  return [...posts];
}

export function compareTimelinePosts<
  T extends {
    user_id?: string;
    created_at?: string | null;
    id?: number;
    moderation_max_score?: number | null;
  },
>(
  a: T,
  b: T,
  viewerUserId: string | null,
  affinityByAuthor: Map<string, number>,
  relationMultiplierByAuthor: Map<string, number>
): number {
  const va = computeTimelineVirtualSortMs(
    a,
    viewerUserId,
    affinityByAuthor,
    relationMultiplierByAuthor
  );
  const vb = computeTimelineVirtualSortMs(
    b,
    viewerUserId,
    affinityByAuthor,
    relationMultiplierByAuthor
  );
  const d = vb - va;
  if (Math.abs(d) > 1e-6) return d > 0 ? 1 : d < 0 ? -1 : 0;

  const idB = b.id ?? 0;
  const idA = a.id ?? 0;
  return idB > idA ? 1 : idB < idA ? -1 : 0;
}

export function sortTimelinePosts<
  T extends {
    user_id?: string;
    created_at?: string | null;
    id?: number;
    moderation_max_score?: number | null;
  },
>(
  posts: T[],
  viewerUserId: string | null,
  affinityByAuthor: Map<string, number>,
  relationMultiplierByAuthor: Map<string, number>
): T[] {
  return [...posts].sort((a, b) =>
    compareTimelinePosts(
      a,
      b,
      viewerUserId,
      affinityByAuthor,
      relationMultiplierByAuthor
    )
  );
}
