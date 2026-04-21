import type { SupabaseClient, User } from "@supabase/supabase-js";

import { friendlyClientDbMessage } from "@/lib/client-db-error";
import { POST_AND_REPLY_MAX_CHARS } from "@/lib/compose-text-limits";
import { markPostNeedsSecondModeration } from "@/lib/pending-second-moderation";
import { normalizePerspectiveScores } from "@/lib/perspective-labels";
import {
  removePostImageIfAny,
  type PreparedPostImage,
  uploadPostImage,
} from "@/lib/post-image-storage";
import type { TimelineToastState } from "@/lib/timeline-types";
import {
  HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD,
} from "@/lib/toxicity-filter-level";
import { POST_HIGH_TOXICITY_VISIBILITY_NOTICE } from "@/lib/visibility-notice";

/**
 * タイムライン画面の新規投稿送信処理。
 * 旧 `app/(main)/page.tsx` の `handleSubmit`（約 200 行）をそのまま
 * モジュール関数に切り出したもの。挙動は変えていない。
 *
 * 設計方針:
 *   - 依存は引数オブジェクトで渡す（setToast / setPostSubmitting など）
 *   - 返り値は void。UI 更新は呼び出し元の state を setter 経由で変更
 *   - モデレーション API / DB insert / image upload / 2nd moderation マーキング
 *     の失敗ケースは cleanup_audit 旧章 4 の再発防止として全て setToast で通知
 */
export async function submitTimelinePost(args: {
  input: string;
  userId: string;
  composePostImage: PreparedPostImage | null;
  moderationMode: "mock" | "perspective";
  supabase: SupabaseClient;
  setToast: (t: TimelineToastState | null) => void;
  setPostSubmitting: (v: boolean) => void;
  setModerationDegradedMessage: (v: string | null) => void;
  setPostScoresById: (
    updater: (prev: Record<number, { first?: Record<string, number>; second?: Record<string, number> }>) => Record<number, { first?: Record<string, number>; second?: Record<string, number> }>
  ) => void;
  setInput: (v: string) => void;
  setComposePostImage: (v: PreparedPostImage | null) => void;
  setComposeOpen: (v: boolean) => void;
  setUser: (u: User | null) => void;
  refetchPosts: () => Promise<void>;
}): Promise<void> {
  const {
    input,
    userId,
    composePostImage,
    moderationMode,
    supabase,
    setToast,
    setPostSubmitting,
    setModerationDegradedMessage,
    setPostScoresById,
    setInput,
    setComposePostImage,
    setComposeOpen,
    setUser,
    refetchPosts,
  } = args;

  const textContent = input.trim();
  if (!textContent && !composePostImage) {
    setToast({ message: "投稿内容を入力してください。", tone: "error" });
    return;
  }
  if (!textContent && composePostImage) {
    setToast({
      message: "画像を添付する場合は本文を入力してください。",
      tone: "error",
    });
    return;
  }
  if (textContent.length > POST_AND_REPLY_MAX_CHARS) {
    setToast({
      message: `投稿は${POST_AND_REPLY_MAX_CHARS}文字以内にしてください。`,
      tone: "error",
    });
    return;
  }

  setPostSubmitting(true);

  let postOverallMax = 0;
  let postScores: Record<string, number> = {};

  if (textContent) {
    try {
      const res = await fetch("/api/moderate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: textContent,
          mode: moderationMode,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        overallMax?: number;
        mode?: "auto" | "mock" | "perspective";
        truncated?: boolean;
        paragraphs?: Array<{
          index: number;
          text: string;
          maxScore: number;
          scores: Record<string, number>;
        }>;
        degraded?: boolean;
        degradedReason?: string;
      };
      if (!res.ok) {
        setToast({
          message:
            json.error ??
            "投稿チェックに失敗しました。時間をおいて再試行してください。",
          tone: "error",
        });
        setPostSubmitting(false);
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
      postScores = normalizePerspectiveScores(
        json.paragraphs?.[0]?.scores as Record<string, unknown> | undefined
      );
      let maxFromApi =
        typeof json.overallMax === "number" ? json.overallMax : 0;
      if (maxFromApi === 0 && Object.keys(postScores).length > 0) {
        maxFromApi = Math.max(...Object.values(postScores));
      }
      postOverallMax = maxFromApi;
    } catch (err) {
      console.error("moderation error:", err);
      setToast({
        message:
          "投稿チェックに失敗しました。通信状況をご確認のうえ再試行してください。",
        tone: "error",
      });
      setPostSubmitting(false);
      return;
    }
  }

  const { data: sessionWrap, error: sessionReadErr } =
    await supabase.auth.getSession();
  if (sessionReadErr) {
    console.error("getSession error:", sessionReadErr);
  }
  const sessionUser = sessionWrap.session?.user;
  if (!sessionUser?.id) {
    setToast({
      message: "セッションが切れました。再度ログインしてください。",
      tone: "error",
    });
    setPostSubmitting(false);
    return;
  }
  const authorId = sessionUser.id;
  if (authorId !== userId) {
    setUser(sessionUser);
  }

  const { data, error } = await supabase
    .from("posts")
    .insert({
      content: textContent,
      user_id: authorId,
      moderation_max_score: postOverallMax,
      moderation_dev_scores:
        Object.keys(postScores).length > 0 ? { first: postScores } : null,
    })
    .select()
    .single();

  if (error) {
    console.error("insert error:", error);
    setToast({
      message: friendlyClientDbMessage(error.message),
      tone: "error",
    });
    setPostSubmitting(false);
    return;
  }

  if (!data) {
    setToast({
      message: "投稿の保存結果が取得できませんでした。再試行してください。",
      tone: "error",
    });
    setPostSubmitting(false);
    return;
  }

  if (composePostImage) {
    const up = await uploadPostImage(
      supabase,
      authorId,
      data.id,
      composePostImage
    );
    if (!up.ok) {
      await supabase.from("posts").delete().eq("id", data.id);
      setToast({
        message:
          "画像のアップロードに失敗しました。形式や容量をご確認ください。",
        tone: "error",
      });
      setPostSubmitting(false);
      return;
    }
    const { error: updErr } = await supabase
      .from("posts")
      .update({ image_storage_path: up.path })
      .eq("id", data.id)
      .eq("user_id", authorId);
    if (updErr) {
      await removePostImageIfAny(supabase, up.path);
      await supabase.from("posts").delete().eq("id", data.id);
      setToast({
        message: friendlyClientDbMessage(updErr.message),
        tone: "error",
      });
      setPostSubmitting(false);
      return;
    }
  }

  markPostNeedsSecondModeration(data.id);
  if (Object.keys(postScores).length > 0) {
    setPostScoresById((prev) => ({
      ...prev,
      [data.id]: { first: postScores },
    }));
  }
  setInput("");
  setComposePostImage(null);
  setComposeOpen(false);
  if (postOverallMax >= HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD) {
    setToast({
      message: POST_HIGH_TOXICITY_VISIBILITY_NOTICE,
      tone: "default",
    });
  }
  await refetchPosts();
  setPostSubmitting(false);
}
