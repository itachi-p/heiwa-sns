import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeTextModeration } from "@/lib/server/moderation";
import { POST_EDIT_WINDOW_MS } from "@/lib/post-edit-window";

function cutoffIso(): string {
  return new Date(Date.now() - POST_EDIT_WINDOW_MS).toISOString();
}

/**
 * 投稿・返信の pending を確定する（cron 用は filterUserId なし、自分用は filterUserId のみ）。
 */
export async function finalizePendingPostsAndReplies(
  admin: SupabaseClient,
  options?: { filterUserId?: string }
): Promise<{ finalizedPosts: number; finalizedReplies: number }> {
  const cutoff = cutoffIso();
  const uid = options?.filterUserId;

  let postsQuery = admin
    .from("posts")
    .select("id, pending_content")
    .lte("created_at", cutoff)
    .not("pending_content", "is", null);
  if (uid) postsQuery = postsQuery.eq("user_id", uid);

  const { data: posts, error: postsError } = await postsQuery;
  if (postsError) throw new Error(postsError.message);

  let finalizedPosts = 0;
  for (const p of posts ?? []) {
    const next = String(p.pending_content ?? "").trim();
    if (!next) {
      await admin.from("posts").update({ pending_content: null }).eq("id", p.id);
      continue;
    }
    const moderation = await analyzeTextModeration(next, "perspective");
    await admin
      .from("posts")
      .update({
        content: next,
        moderation_max_score: moderation.overallMax,
        pending_content: null,
      })
      .eq("id", p.id);
    finalizedPosts += 1;
  }

  let repliesQuery = admin
    .from("post_replies")
    .select("id, pending_content")
    .lte("created_at", cutoff)
    .not("pending_content", "is", null);
  if (uid) repliesQuery = repliesQuery.eq("user_id", uid);

  const { data: replies, error: repliesError } = await repliesQuery;
  if (repliesError) throw new Error(repliesError.message);

  let finalizedReplies = 0;
  for (const r of replies ?? []) {
    const next = String(r.pending_content ?? "").trim();
    if (!next) {
      await admin.from("post_replies").update({ pending_content: null }).eq("id", r.id);
      continue;
    }
    const moderation = await analyzeTextModeration(next, "perspective");
    await admin
      .from("post_replies")
      .update({
        content: next,
        moderation_max_score: moderation.overallMax,
        pending_content: null,
      })
      .eq("id", r.id);
    finalizedReplies += 1;
  }

  return { finalizedPosts, finalizedReplies };
}
