import type { SupabaseClient } from "@supabase/supabase-js";

import { POST_AND_REPLY_MAX_CHARS } from "@/lib/compose-text-limits";
import { markReplyNeedsSecondModeration } from "@/lib/pending-second-moderation";
import { normalizePerspectiveScores } from "@/lib/perspective-labels";
import type { TimelinePost, TimelinePostReply, TimelineToastState } from "@/lib/timeline-types";
import { HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD } from "@/lib/toxicity-filter-level";
import { REPLY_HIGH_TOXICITY_VISIBILITY_NOTICE } from "@/lib/visibility-notice";

/**
 * ルート投稿＝相手 / 別返信元＝相手 の対人関係に対し、悪質な返信を
 * `reply_toxic_events` に記録するときの閾値（score スケール 0..1）。
 * 旧 page.tsx の同名定数と同じ値。
 */
const RELATION_PENALTY_MIN_SCORE = 0.2;

/**
 * タイムライン画面の返信送信処理。
 * 旧 `app/(main)/page.tsx` の `handleReplySubmit`（約 160 行）を
 * そのままモジュール関数に切り出したもの。挙動は一切変えていない。
 */
export async function submitTimelineReply(args: {
  postId: number;
  userId: string;
  replyDraft: string;
  replySubmittingPostId: number | null;
  replyParentReplyId: number | null;
  repliesByPost: Record<number, TimelinePostReply[]>;
  posts: TimelinePost[];
  moderationMode: "mock" | "perspective";
  supabase: SupabaseClient;
  setErrorMessage: (v: string | null) => void;
  setToast: (t: TimelineToastState | null) => void;
  setReplySubmittingPostId: (v: number | null) => void;
  setModerationDegradedMessage: (v: string | null) => void;
  setReplyScoresById: (
    updater: (
      prev: Record<number, { first?: Record<string, number>; second?: Record<string, number> }>
    ) => Record<number, { first?: Record<string, number>; second?: Record<string, number> }>
  ) => void;
  setReplyDrafts: (
    updater: (prev: Record<number, string>) => Record<number, string>
  ) => void;
  setReplyParentReplyId: (v: number | null) => void;
  setReplyComposerPostId: (v: number | null) => void;
  refetchPosts: () => Promise<void>;
}): Promise<void> {
  const {
    postId,
    userId,
    replyDraft,
    replySubmittingPostId,
    replyParentReplyId,
    repliesByPost,
    posts,
    moderationMode,
    supabase,
    setErrorMessage,
    setToast,
    setReplySubmittingPostId,
    setModerationDegradedMessage,
    setReplyScoresById,
    setReplyDrafts,
    setReplyParentReplyId,
    setReplyComposerPostId,
    refetchPosts,
  } = args;

  const content = replyDraft.trim();
  if (!content) {
    setToast({ message: "返信を入力してください。", tone: "error" });
    return;
  }
  if (content.length > POST_AND_REPLY_MAX_CHARS) {
    setToast({
      message: `返信は${POST_AND_REPLY_MAX_CHARS}文字以内にしてください。`,
      tone: "error",
    });
    return;
  }
  if (replySubmittingPostId != null) return;

  const flat = repliesByPost[postId] ?? [];
  const parentReplyId: number | null = replyParentReplyId;
  const parentReply =
    parentReplyId != null ? flat.find((x) => x.id === parentReplyId) : null;
  if (parentReplyId != null) {
    if (!parentReply || parentReply.post_id !== postId) {
      setErrorMessage("返信先が見つかりません。");
      return;
    }
  }

  setReplySubmittingPostId(postId);
  setErrorMessage(null);

  try {
    const res = await fetch("/api/moderate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: content,
        mode: moderationMode,
      }),
    });
    const json = (await res.json()) as {
      error?: string;
      overallMax?: number;
      mode?: string;
      degraded?: boolean;
      degradedReason?: string;
      paragraphs?: Array<{
        index: number;
        text: string;
        maxScore: number;
        scores: Record<string, number>;
      }>;
    };
    if (!res.ok) {
      setErrorMessage(json?.error ?? "AI判定に失敗しました。");
      return;
    }
    if (json.degraded) {
      setModerationDegradedMessage(
        json.degradedReason ??
          "APIの利用制限などにより、簡易チェックに切り替えました。"
      );
    } else {
      setModerationDegradedMessage(null);
    }

    const scores = normalizePerspectiveScores(
      json.paragraphs?.[0]?.scores as Record<string, unknown> | undefined
    );
    const overallMax =
      typeof json.overallMax === "number" ? json.overallMax : 0;

    const insertRow: {
      post_id: number;
      user_id: string;
      content: string;
      parent_reply_id?: number;
      moderation_max_score: number;
      moderation_dev_scores: { first: Record<string, number> } | null;
    } = {
      post_id: postId,
      user_id: userId,
      content,
      moderation_max_score: overallMax,
      moderation_dev_scores:
        Object.keys(scores).length > 0 ? { first: scores } : null,
    };
    if (parentReplyId != null) {
      insertRow.parent_reply_id = parentReplyId;
    }

    const { data: insertedReply, error } = await supabase
      .from("post_replies")
      .insert(insertRow)
      .select("id")
      .single();

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    if (insertedReply) {
      markReplyNeedsSecondModeration(insertedReply.id);
      if (Object.keys(scores).length > 0) {
        setReplyScoresById((prev) => ({
          ...prev,
          [insertedReply.id]: { first: scores },
        }));
      }
    }

    const targetUserId =
      parentReply?.user_id ??
      posts.find((p) => p.id === postId)?.user_id ??
      null;
    if (
      insertedReply &&
      targetUserId &&
      targetUserId !== userId &&
      overallMax > RELATION_PENALTY_MIN_SCORE
    ) {
      const { error: evErr } = await supabase
        .from("reply_toxic_events")
        .insert({
          actor_user_id: userId,
          target_user_id: targetUserId,
          post_id: postId,
          reply_id: insertedReply.id,
          max_score: overallMax,
        });
      if (evErr) {
        console.warn("reply_toxic_events insert failed:", evErr.message);
      }
    }

    setReplyDrafts((prev) => ({ ...prev, [postId]: "" }));
    setReplyParentReplyId(null);
    setReplyComposerPostId(null);
    if (overallMax >= HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD) {
      setToast({
        message: REPLY_HIGH_TOXICITY_VISIBILITY_NOTICE,
        tone: "default",
      });
    }
    await refetchPosts();
  } catch (err) {
    console.error("reply moderation error:", err);
    setErrorMessage("AI判定に失敗しました。");
  } finally {
    setReplySubmittingPostId(null);
  }
}
