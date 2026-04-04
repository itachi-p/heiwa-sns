/**
 * タイムライン並び（`app/page.tsx` のみ使用）。
 * **created_at（ミリ秒）を第一キー**とし、より新しい投稿が常に上。
 * 「スキ」等の二次スコアは **同一タイムスタンプのタイブレーク** にのみ効く（通常は同順位）。
 */

/** 互換・文書用。並びには使わない（旧 5 分スロット方式の名残） */
export const TIMELINE_SORT_SLOT_MS = 5 * 60 * 1000;

/** @deprecated 旧「同一作者連続緩和」用。現在の並びでは未使用。 */
export const TIMELINE_MAX_CONSECUTIVE_SAME_AUTHOR = 2;

/**
 * 「スキ」由来の加点（タイブレーク用のみ）。対数で飽和し無制限に上がらない。
 */
export function affinitySortContribution(likeScore: number): number {
  const s = Number.isFinite(likeScore) ? Math.max(0, likeScore) : 0;
  return Math.min(0.08, Math.log1p(s) * 0.012);
}

/**
 * reply_toxic_events 由来の乗数（従来 0.5〜0.8）を、並び用に弱い減衰 0.97〜1.0 に圧縮。
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

function secondarySortScore(
  post: { user_id?: string; created_at?: string | null },
  viewerUserId: string | null,
  affinityByAuthor: Map<string, number>,
  toxByAuthor: Map<string, number>
): number {
  const like = post.user_id ? affinityByAuthor.get(post.user_id) ?? 0 : 0;
  const tox = post.user_id ? toxByAuthor.get(post.user_id) ?? 1 : 1;
  const aff = affinitySortContribution(like) * toxicitySortSoftFactor(tox);
  const own =
    viewerUserId && sameUser(post.user_id, viewerUserId) ? 0.1 : 0;
  return aff + own;
}

/**
 * **第1キー**: `created_at` のエポック ms **降順**（新しいほど上。1ms でも差があればそれが優先）。
 * **第2キー**: 同一 ms のみ二次スコア（スキ・軽い毒性・自分投稿の微ブースト）。
 * **第3キー**: `id` 降順（安定化）。
 */
export function compareTimelinePosts(
  a: { user_id?: string; created_at?: string | null; id?: number },
  b: { user_id?: string; created_at?: string | null; id?: number },
  viewerUserId: string | null,
  affinityByAuthor: Map<string, number>,
  toxByAuthor: Map<string, number>
): number {
  const ta = createdMs(a);
  const tb = createdMs(b);
  if (tb !== ta) return tb > ta ? 1 : tb < ta ? -1 : 0;

  const secB = secondarySortScore(b, viewerUserId, affinityByAuthor, toxByAuthor);
  const secA = secondarySortScore(a, viewerUserId, affinityByAuthor, toxByAuthor);
  const d = secB - secA;
  if (Math.abs(d) > 1e-12) return d > 0 ? 1 : d < 0 ? -1 : 0;

  const idB = b.id ?? 0;
  const idA = a.id ?? 0;
  return idB > idA ? 1 : idB < idA ? -1 : 0;
}

/**
 * @deprecated 旧 5 分スロット用。`created_at` 優先後は順序を崩すため `sortTimelinePosts` では呼ばない。
 */
export function softenSameAuthorStreaks<
  T extends { user_id?: string; created_at?: string | null },
>(posts: T[]): T[] {
  return [...posts];
}

export function sortTimelinePosts<
  T extends { user_id?: string; created_at?: string | null; id?: number },
>(
  posts: T[],
  viewerUserId: string | null,
  affinityByAuthor: Map<string, number>,
  toxByAuthor: Map<string, number>
): T[] {
  return [...posts].sort((a, b) =>
    compareTimelinePosts(a, b, viewerUserId, affinityByAuthor, toxByAuthor)
  );
}
