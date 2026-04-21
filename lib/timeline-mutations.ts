import type { SupabaseClient } from "@supabase/supabase-js";

import { POST_AND_REPLY_MAX_CHARS } from "@/lib/compose-text-limits";
import {
  markPostNeedsSecondModeration,
  markReplyNeedsSecondModeration,
} from "@/lib/pending-second-moderation";
import { removePostImageIfAny } from "@/lib/post-image-storage";
import type { TimelinePost, TimelineToastState } from "@/lib/timeline-types";

/**
 * タイムライン画面の投稿・返信に対する小粒なミューテーション群
 * （編集 pending 化 / 削除 / Like トグル）を一箇所に集約したもの。
 *
 * 旧 `app/(main)/page.tsx` の handleDeleteReply / handleSaveReplyEdit /
 * handleDeletePost / handleSavePostEdit / handleLike の本体をそのまま移植。
 * 挙動は変えていない（confirm ダイアログ / 15 分窓 / 親投稿作者への
 * user_affinity RPC も含む）。
 */

export async function deleteTimelineReply(args: {
  replyId: number;
  editingReplyId: number | null;
  supabase: SupabaseClient;
  setErrorMessage: (v: string | null) => void;
  setEditingReplyId: (v: number | null) => void;
  refetchPosts: () => Promise<void>;
}): Promise<void> {
  const {
    replyId,
    editingReplyId,
    supabase,
    setErrorMessage,
    setEditingReplyId,
    refetchPosts,
  } = args;
  if (!window.confirm("この返信を削除しますか？")) return;
  setErrorMessage(null);
  const { error } = await supabase
    .from("post_replies")
    .delete()
    .eq("id", replyId);
  if (error) {
    setErrorMessage(error.message);
    return;
  }
  if (editingReplyId === replyId) setEditingReplyId(null);
  await refetchPosts();
}

export async function saveTimelineReplyEdit(args: {
  replyId: number;
  userId: string;
  editReplyDraft: string;
  supabase: SupabaseClient;
  setToast: (t: TimelineToastState | null) => void;
  setErrorMessage: (v: string | null) => void;
  setReplyEditSaving: (v: boolean) => void;
  setEditingReplyId: (v: number | null) => void;
  refetchPosts: () => Promise<void>;
}): Promise<void> {
  const {
    replyId,
    userId,
    editReplyDraft,
    supabase,
    setToast,
    setErrorMessage,
    setReplyEditSaving,
    setEditingReplyId,
    refetchPosts,
  } = args;

  const content = editReplyDraft.trim();
  if (!content) {
    setToast({ message: "本文を入力してください。", tone: "error" });
    return;
  }
  if (content.length > POST_AND_REPLY_MAX_CHARS) {
    setToast({
      message: `返信は${POST_AND_REPLY_MAX_CHARS}文字以内にしてください。`,
      tone: "error",
    });
    return;
  }
  setReplyEditSaving(true);
  setErrorMessage(null);
  const { error } = await supabase
    .from("post_replies")
    .update({ pending_content: content })
    .eq("id", replyId)
    .eq("user_id", userId);
  setReplyEditSaving(false);
  if (error) {
    setToast({ message: error.message, tone: "error" });
    return;
  }
  setEditingReplyId(null);
  markReplyNeedsSecondModeration(replyId);
  setToast({
    message: "編集を保存しました。15分後に反映されます。",
    tone: "default",
  });
  await refetchPosts();
}

export async function deleteTimelinePost(args: {
  postId: number;
  imageStoragePath: string | null | undefined;
  userId: string;
  editingPostId: number | null;
  supabase: SupabaseClient;
  setErrorMessage: (v: string | null) => void;
  setEditingPostId: (v: number | null) => void;
  refetchPosts: () => Promise<void>;
}): Promise<void> {
  const {
    postId,
    imageStoragePath,
    userId,
    editingPostId,
    supabase,
    setErrorMessage,
    setEditingPostId,
    refetchPosts,
  } = args;
  if (!window.confirm("この投稿を削除しますか？")) return;
  setErrorMessage(null);
  await removePostImageIfAny(supabase, imageStoragePath);
  const { error } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("user_id", userId);
  if (error) {
    setErrorMessage(error.message);
    return;
  }
  if (editingPostId === postId) setEditingPostId(null);
  await refetchPosts();
}

export async function saveTimelinePostEdit(args: {
  postId: number;
  userId: string;
  editDraft: string;
  posts: TimelinePost[];
  postEditSaving: boolean;
  supabase: SupabaseClient;
  setToast: (t: TimelineToastState | null) => void;
  setErrorMessage: (v: string | null) => void;
  setPostEditSaving: (v: boolean) => void;
  setEditingPostId: (v: number | null) => void;
  refetchPosts: () => Promise<void>;
}): Promise<void> {
  const {
    postId,
    userId,
    editDraft,
    posts,
    postEditSaving,
    supabase,
    setToast,
    setErrorMessage,
    setPostEditSaving,
    setEditingPostId,
    refetchPosts,
  } = args;

  if (postEditSaving) return;
  const content = editDraft.trim();
  const existing = posts.find((p) => p.id === postId);
  const hasImage = Boolean(existing?.image_storage_path?.trim());
  if (!content) {
    setToast({
      message: hasImage ? "投稿には本文が必要です" : "本文を入力してください。",
      tone: "error",
    });
    return;
  }
  if (content.length > POST_AND_REPLY_MAX_CHARS) {
    setToast({
      message: `投稿は${POST_AND_REPLY_MAX_CHARS}文字以内にしてください。`,
      tone: "error",
    });
    return;
  }
  setPostEditSaving(true);
  setErrorMessage(null);
  let error: { message: string } | null = null;
  try {
    const res = await supabase
      .from("posts")
      .update({ pending_content: content })
      .eq("id", postId)
      .eq("user_id", userId);
    error = res.error;
  } catch {
    setPostEditSaving(false);
    setToast({
      message: "通信エラーが発生しました。もう一度お試しください。",
      tone: "error",
    });
    return;
  }
  setPostEditSaving(false);
  if (error) {
    setToast({ message: error.message, tone: "error" });
    return;
  }
  setEditingPostId(null);
  markPostNeedsSecondModeration(postId);
  setToast({
    message: "編集を保存しました。15分後に反映されます。",
    tone: "default",
  });
  await refetchPosts();
}

/**
 * Like のトグル。未 like → insert (+ 親投稿作者が別人なら user_affinity RPC)、
 * like 済み → delete。挙動は旧 page.tsx と同じ（一覧は再 fetch しない、
 * スクロール位置維持のため）。
 */
export async function toggleTimelineLike(args: {
  postId: number;
  userId: string;
  likedPostIds: Set<number>;
  posts: TimelinePost[];
  supabase: SupabaseClient;
  setErrorMessage: (v: string | null) => void;
  setLikedPostIds: (
    updater: (prev: Set<number>) => Set<number>
  ) => void;
}): Promise<void> {
  const {
    postId,
    userId,
    likedPostIds,
    posts,
    supabase,
    setErrorMessage,
    setLikedPostIds,
  } = args;

  const liked = likedPostIds.has(postId);

  if (liked) {
    const { error } = await supabase
      .from("likes")
      .delete()
      .eq("user_id", userId)
      .eq("post_id", postId);

    if (error) {
      console.error("unlike error:", error);
      setErrorMessage(error.message);
      return;
    }

    setErrorMessage(null);
    setLikedPostIds((prev) => {
      const next = new Set(prev);
      next.delete(postId);
      return next;
    });
    return;
  }

  const { error } = await supabase.from("likes").upsert(
    { user_id: userId, post_id: postId },
    { onConflict: "user_id,post_id" }
  );

  if (error) {
    console.error("like error:", error);
    setErrorMessage(error.message);
    return;
  }

  const authorId = posts.find((p) => p.id === postId)?.user_id;
  if (authorId && authorId !== userId) {
    const { error: affErr } = await supabase.rpc(
      "apply_user_affinity_on_like",
      { p_liker: userId, p_author: authorId }
    );
    if (affErr) {
      console.warn("user_affinity rpc:", affErr.message);
    }
  }

  setErrorMessage(null);
  setLikedPostIds((prev) => {
    const next = new Set(prev);
    next.add(postId);
    return next;
  });
}
