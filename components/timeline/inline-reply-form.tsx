import type { Dispatch, SetStateAction } from "react";

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
  } = props;

  const placeholder = (() => {
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
    return `${n}（${pid}）に返信`;
  })();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!tryInteraction()) return;
        void handleReplySubmit(inlineReplyPostId);
      }}
      className="fixed inset-x-2 bottom-2 z-[56] flex items-end gap-2 rounded-2xl border border-gray-200 bg-white p-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] shadow-lg"
    >
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
        placeholder={placeholder}
        maxRows={4}
        maxLength={POST_AND_REPLY_MAX_CHARS}
        disabled={replySubmittingPostId === inlineReplyPostId}
        className="min-h-[2.2rem] min-w-0 flex-1 resize-none overflow-hidden rounded-2xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
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
    </form>
  );
}
