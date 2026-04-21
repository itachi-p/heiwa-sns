import type { SupabaseClient } from "@supabase/supabase-js";

import {
  effectiveScoreForViewerToxicityFilter,
  thresholdForLevel,
  type ToxicityFilterLevel,
  type ToxicityOverThresholdBehavior,
} from "@/lib/toxicity-filter-level";
import { ANON_TOXICITY_VIEW_THRESHOLD } from "@/lib/timeline-threshold";
import { sortTimelinePosts } from "@/lib/timeline-sort";
import type { TimelinePost, TimelinePostReply } from "@/lib/timeline-types";

/** ルート投稿あたり、相手からの悪質返信を遡って見る期間。旧 page.tsx と同じ値 */
const RELATION_PENALTY_WINDOW_DAYS = 14;

type PublicProfile = {
  id: string;
  nickname: string | null;
  avatar_url?: string | null;
  avatar_placeholder_hex?: string | null;
  public_id?: string | null;
};

/**
 * users テーブルに対する通常の select が RLS/401 などで失敗した場合のフォールバック。
 * 匿名やセッション切れの状況でも限定的にプロフィールを引けるようにする。
 */
async function fetchPublicProfilesByIds(
  userIds: string[]
): Promise<PublicProfile[]> {
  if (userIds.length === 0) return [];
  const res = await fetch("/api/public-profiles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userIds }),
  });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as
    | { profiles?: PublicProfile[] }
    | null;
  return Array.isArray(json?.profiles) ? json.profiles : [];
}

type UserProfileMini = {
  nickname: string | null;
  avatar_url: string | null;
  avatar_placeholder_hex: string | null;
  public_id: string | null;
};

function buildProfileMap(
  rows: PublicProfile[]
): Map<string, UserProfileMini> {
  const map = new Map<string, UserProfileMini>();
  for (const row of rows) {
    map.set(row.id, {
      nickname: row.nickname,
      avatar_url: row.avatar_url ?? null,
      avatar_placeholder_hex: row.avatar_placeholder_hex ?? null,
      public_id:
        typeof row.public_id === "string"
          ? row.public_id.trim() || null
          : null,
    });
  }
  return map;
}

/**
 * posts を `range(start, end)` で取得し、プロフィール・関係スコア・親密度を
 * まとめて enrich＆並び替えた「表示用タイムライン」を返す。
 *
 * 旧 page.tsx の `fetchPosts` 内の前半（posts 取得〜sortTimelinePosts 呼び出し）
 * をそのまま関数化。副作用（setState）は呼び出し元で行う。
 */
export async function loadTimelinePostsPage(args: {
  supabase: SupabaseClient;
  start: number;
  pageSize: number;
  userId: string | null;
  toxicityFilterLevel: ToxicityFilterLevel;
  toxicityOverThresholdBehavior: ToxicityOverThresholdBehavior;
  append: boolean;
  existingPosts: TimelinePost[];
}): Promise<
  | { ok: true; posts: TimelinePost[]; hasMore: boolean; nextOffset: number }
  | { ok: false; error: string }
> {
  const {
    supabase,
    start,
    pageSize,
    userId,
    toxicityFilterLevel,
    toxicityOverThresholdBehavior,
    append,
    existingPosts,
  } = args;

  const end = start + pageSize - 1;
  const { data: rows, error } = await supabase
    .from("posts")
    .select("*")
    .range(start, end)
    .order("created_at", { ascending: false });

  if (error) {
    return { ok: false, error: error.message };
  }

  const pageRows = (rows ?? []) as TimelinePost[];
  const hasMore = pageRows.length === pageSize;
  const nextOffset = start + pageRows.length;

  const list = append
    ? ([
        ...existingPosts,
        ...pageRows.filter(
          (r) => !existingPosts.some((p) => p.id === r.id)
        ),
      ] as TimelinePost[])
    : pageRows;

  const authorIds = [
    ...new Set(
      list
        .map((p) => p.user_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const profilePromise =
    authorIds.length > 0
      ? supabase
          .from("users")
          .select(
            "id, nickname, avatar_url, avatar_placeholder_hex, public_id"
          )
          .in("id", authorIds)
      : Promise.resolve({ data: null, error: null });

  const relationPromise = userId
    ? (() => {
        const since = new Date(
          Date.now() - RELATION_PENALTY_WINDOW_DAYS * 24 * 60 * 60 * 1000
        ).toISOString();
        return supabase
          .from("reply_toxic_events")
          .select("actor_user_id, max_score")
          .eq("target_user_id", userId)
          .gte("created_at", since);
      })()
    : Promise.resolve({ data: null, error: null });

  const affinityPromise = userId
    ? supabase
        .from("user_affinity")
        .select("to_user_id, like_score")
        .eq("from_user_id", userId)
    : Promise.resolve({ data: null, error: null });

  const [
    { data: profiles, error: profileError },
    { data: evRows, error: evErr },
    { data: affRows, error: affErr },
  ] = await Promise.all([profilePromise, relationPromise, affinityPromise]);

  const fallbackProfiles =
    profileError != null ? await fetchPublicProfilesByIds(authorIds) : [];
  const profileByUserId = buildProfileMap(
    (profileError ? fallbackProfiles : (profiles as PublicProfile[] | null) ?? [])
  );

  const merged: TimelinePost[] = list.map((p) => ({
    ...p,
    users: {
      nickname: p.user_id
        ? profileByUserId.get(p.user_id)?.nickname ?? null
        : null,
      avatar_url: p.user_id
        ? profileByUserId.get(p.user_id)?.avatar_url ?? null
        : null,
      avatar_placeholder_hex: p.user_id
        ? profileByUserId.get(p.user_id)?.avatar_placeholder_hex ?? null
        : null,
      public_id: p.user_id
        ? profileByUserId.get(p.user_id)?.public_id ?? null
        : null,
    },
  }));

  const relationMultiplierByAuthor = new Map<string, number>();
  if (userId && !evErr) {
    for (const row of (evRows as Array<{ actor_user_id: string; max_score: number | null }> | null) ?? []) {
      const actor = row.actor_user_id;
      const m = Math.max(0.5, Math.min(0.8, 1 - Number(row.max_score ?? 0)));
      relationMultiplierByAuthor.set(
        actor,
        Math.min(relationMultiplierByAuthor.get(actor) ?? 1, m)
      );
    }
  }

  const affinityLikeScoreByAuthor = new Map<string, number>();
  if (userId && !affErr) {
    for (const row of (affRows as Array<{ to_user_id: string; like_score: number | null }> | null) ?? []) {
      const toId = row.to_user_id;
      affinityLikeScoreByAuthor.set(
        toId,
        typeof row.like_score === "number" ? row.like_score : 0
      );
    }
  }

  const viewThreshold = userId
    ? thresholdForLevel(toxicityFilterLevel)
    : ANON_TOXICITY_VIEW_THRESHOLD;

  const visibleForTimeline =
    toxicityOverThresholdBehavior === "hide"
      ? merged.filter((p) => {
          const score = effectiveScoreForViewerToxicityFilter(
            p.moderation_max_score
          );
          if (userId && p.user_id === userId) return true;
          return score <= viewThreshold;
        })
      : merged;

  const timelinePosts = sortTimelinePosts(
    visibleForTimeline,
    userId,
    affinityLikeScoreByAuthor,
    relationMultiplierByAuthor
  );

  return { ok: true, posts: timelinePosts, hasMore, nextOffset };
}

/**
 * 指定された post id 群の返信をまとめて取得し、プロフィール情報を enrich した
 * `{ [postId]: replies[] }` を返す。旧 page.tsx の `fetchPosts` 内の後半の
 * 返信取得パートをそのまま関数化。
 */
export async function loadRepliesForPosts(args: {
  supabase: SupabaseClient;
  postIds: number[];
}): Promise<
  | { ok: true; byPost: Record<number, TimelinePostReply[]> }
  | { ok: false; error: string }
> {
  const { supabase, postIds } = args;
  if (postIds.length === 0) {
    return { ok: true, byPost: {} };
  }
  const { data: replyRows, error: replyErr } = await supabase
    .from("post_replies")
    .select("*")
    .in("post_id", postIds)
    .order("created_at", { ascending: true });

  if (replyErr) {
    return { ok: false, error: replyErr.message };
  }

  const rlist = (replyRows ?? []) as Array<{
    id: number;
    post_id: number;
    user_id: string;
    content: string;
    pending_content?: string | null;
    created_at?: string;
    parent_reply_id?: number | null;
  }>;

  const replyAuthorIds = [
    ...new Set(rlist.map((r) => r.user_id).filter(Boolean)),
  ];

  let profileByUserId = new Map<string, UserProfileMini>();
  if (replyAuthorIds.length > 0) {
    const { data: rprofiles, error: rpe } = await supabase
      .from("users")
      .select("id, nickname, avatar_url, avatar_placeholder_hex, public_id")
      .in("id", replyAuthorIds);
    const fallbackReplyProfiles =
      rpe != null ? await fetchPublicProfilesByIds(replyAuthorIds) : [];
    profileByUserId = buildProfileMap(
      rpe ? fallbackReplyProfiles : (rprofiles as PublicProfile[] | null) ?? []
    );
  }

  const byPost: Record<number, TimelinePostReply[]> = {};
  for (const r of rlist) {
    const arr = byPost[r.post_id] ?? [];
    const rp = profileByUserId.get(r.user_id);
    arr.push({
      ...r,
      users: {
        nickname: rp?.nickname ?? null,
        avatar_url: rp?.avatar_url ?? null,
        avatar_placeholder_hex: rp?.avatar_placeholder_hex ?? null,
        public_id: rp?.public_id ?? null,
      },
    });
    byPost[r.post_id] = arr;
  }

  return { ok: true, byPost };
}
