import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { AutosizeTextarea } from "@/components/autosize-textarea";
import { UserAvatar } from "@/components/user-avatar";
import { POST_AND_REPLY_MAX_CHARS } from "@/lib/compose-text-limits";
import {
  displayTimelineName,
  type TimelinePost,
  type TimelinePostReply,
} from "@/lib/timeline-types";

export type InlineReplyFormProps = {
  inlineReplyPostId: number;
  replyDrafts: Record<number, string>;
  setReplyDrafts: Dispatch<SetStateAction<Record<number, string>>>;
  replySubmittingPostId: number | null;
  posts: TimelinePost[];
  repliesByPost: Record<number, TimelinePostReply[]>;
  replyParentReplyId: number | null;
  profileNickname: string | null;
  profileAvatarUrl: string | null;
  profilePlaceholderHex: string | null;
  tryInteraction: () => boolean;
  handleReplySubmit: (postId: number) => void | Promise<void>;
  onClose: () => void;
};

/**
 * タイムライン画面の下部インライン返信フォーム（`bottom-2 z-[56]`）。
 * インライン返信フォームが出ている間は `reply-active-bus` 経由で
 * `MainBottomNav` が隠れる（`app/(main)/layout.tsx` 側の契約）。
 */
export function InlineReplyForm(props: InlineReplyFormProps) {
  const {
    inlineReplyPostId,
    replyDrafts,
    setReplyDrafts,
    replySubmittingPostId,
    posts,
    repliesByPost,
    replyParentReplyId,
    profileNickname,
    profileAvatarUrl,
    profilePlaceholderHex,
    tryInteraction,
    handleReplySubmit,
    onClose,
  } = props;

  const [keyboardInset, setKeyboardInset] = useState(0);
  const targetMeta = useMemo(() => {
    const post = posts.find((p) => p.id === inlineReplyPostId);
    const targetReply =
      replyParentReplyId != null
        ? (repliesByPost[inlineReplyPostId] ?? []).find(
            (r) => r.id === replyParentReplyId
          )
        : null;
    const n = targetReply
      ? displayTimelineName(
          targetReply.users?.nickname,
          targetReply.users?.public_id
        )
      : displayTimelineName(
          post?.users?.nickname,
          post?.users?.public_id
        );
    const pid =
      targetReply?.users?.public_id ?? post?.users?.public_id ?? "ID未設定";
    const base = (targetReply?.content ?? post?.content ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const preview = base.length > 20 ? `${base.slice(0, 20)}…` : base;
    return {
      placeholder: `${n}（${pid}）に返信`,
      guideName: n,
      guidePreview: preview || "（本文なし）",
    };
  }, [inlineReplyPostId, posts, repliesByPost, replyParentReplyId]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!tryInteraction()) return;
        void handleReplySubmit(inlineReplyPostId);
      }}
      className="fixed inset-x-2 z-[56] rounded-2xl border border-gray-200 bg-white p-2 shadow-lg"
      style={{
        bottom: `calc(0.5rem + env(safe-area-inset-bottom, 0px) + ${keyboardInset}px)`,
      }}
    >
      <div className="mb-2 truncate rounded-xl bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
        {targetMeta.guideName} / {targetMeta.guidePreview}
      </div>
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          aria-label="返信を閉じる"
          title="返信を閉じる"
        >
          ×
        </button>
        <UserAvatar
          name={profileNickname}
          avatarUrl={profileAvatarUrl}
          placeholderHex={profilePlaceholderHex}
          size="sm"
        />
        <AutosizeTextarea
          value={replyDrafts[inlineReplyPostId] ?? ""}
          onChange={(e) =>
            setReplyDrafts((prev) => ({
              ...prev,
              [inlineReplyPostId]: e.target.value,
            }))
          }
          placeholder={targetMeta.placeholder}
          maxRows={4}
          maxLength={POST_AND_REPLY_MAX_CHARS}
          disabled={replySubmittingPostId === inlineReplyPostId}
          className="min-h-[2.4rem] min-w-0 flex-1 resize-none overflow-hidden rounded-2xl border border-gray-300 bg-white px-3 py-2 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
        />
      {(replyDrafts[inlineReplyPostId] ?? "").trim().length > 0 ? (
        <button
          type="submit"
          disabled={replySubmittingPostId === inlineReplyPostId}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          aria-label="送信"
          title="送信"
        >
          ↑
        </button>
      ) : null}
      </div>
    </form>
  );
}
