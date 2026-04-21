import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AutosizeTextarea } from "@/components/autosize-textarea";
import { EditCountdownBadge } from "@/components/edit-countdown-badge";
import { ModerationCompactRow } from "@/components/moderation-compact-row";
import { ReplyBubbleIcon } from "@/components/reply-composer-modal";
import { ReplyThread, type PostReplyRow } from "@/components/reply-thread";
import { UserAvatar } from "@/components/user-avatar";
import type { DevScoresById } from "@/lib/dev-scores-local-storage";
import { POST_AND_REPLY_MAX_CHARS } from "@/lib/compose-text-limits";
import {
  canEditOwnPost,
  resolvePendingVisibleContent,
} from "@/lib/post-edit-window";
import { getPostImagePublicUrl } from "@/lib/post-image-storage";
import { renderTextWithLinks } from "@/lib/render-text-with-links";
import {
  displayTimelineName,
  type TimelinePost,
  type TimelinePostReply,
} from "@/lib/timeline-types";
import {
  ANON_TOXICITY_VIEW_THRESHOLD,
} from "@/lib/timeline-threshold";
import {
  effectiveScoreForViewerToxicityFilter,
  thresholdForLevel,
  type ToxicityFilterLevel,
  type ToxicityOverThresholdBehavior,
} from "@/lib/toxicity-filter-level";

export type PostCardProps = {
  post: TimelinePost;
  supabase: SupabaseClient;
  userId: string | null;
  canInteract: boolean;
  toxicityFilterLevel: ToxicityFilterLevel;
  toxicityOverThresholdBehavior: ToxicityOverThresholdBehavior;
  expandedFoldedPosts: Set<number>;
  setExpandedFoldedPosts: Dispatch<SetStateAction<Set<number>>>;
  editingPostId: number | null;
  setEditingPostId: Dispatch<SetStateAction<number | null>>;
  editDraft: string;
  setEditDraft: Dispatch<SetStateAction<string>>;
  postEditSaving: boolean;
  handleDeletePost: (
    postId: number,
    imageStoragePath?: string | null
  ) => void | Promise<void>;
  handleSavePostEdit: (postId: number) => void | Promise<void>;
  handleLike: (postId: number) => void | Promise<void>;
  tryInteraction: () => boolean;
  likedPostIds: Set<number>;
  postScoresById: DevScoresById;
  openedReplyPosts: Set<number>;
  toggleReplyPanel: (postId: number) => void;
  setInlineReplyPostId: Dispatch<SetStateAction<number | null>>;
  setReplyParentReplyId: Dispatch<SetStateAction<number | null>>;
  repliesByPost: Record<number, TimelinePostReply[]>;
  partitionByPost: Record<
    number,
    { roots: TimelinePostReply[]; childrenByParent: Record<number, TimelinePostReply[]> }
  >;
  editingReplyId: number | null;
  editReplyDraft: string;
  replyEditSaving: boolean;
  replyScoresById: DevScoresById;
  stableOnEditDraftChange: (v: string) => void;
  stableOnStartEditReply: (r: PostReplyRow) => void;
  stableOnCancelEditReply: () => void;
  stableOnSaveReplyEdit: (rid: number) => void;
  stableOnDeleteReply: (rid: number) => void;
  likedReplyIds: Set<number>;
  stableOnToggleLikeReply: (replyId: number) => void;
  replyComposerPostId: number | null;
  replyParentReplyId: number | null;
  stableOnReplyBubble: (r: PostReplyRow) => void;
};

/**
 * タイムラインの 1 投稿カード。以前は `app/(main)/page.tsx` の
 * `posts.map((post) => ...)` 内に約 320 行インライン展開されていた JSX を
 * そのまま切り出したもの。ロジックは一切変えていない。
 *
 * 注意: ReplyThread に渡す `onReplyBubble` の呼び出し元は
 * 元実装で `stableOnReplyBubble(postId, parentReplyId)` 形式だが、
 * ReplyThread 側のシグネチャ合わせは呼び出し側（page.tsx）と同じ渡し方に留める。
 */
export function TimelinePostCard(props: PostCardProps) {
  const {
    post,
    supabase,
    userId,
    canInteract,
    toxicityFilterLevel,
    toxicityOverThresholdBehavior,
    expandedFoldedPosts,
    setExpandedFoldedPosts,
    editingPostId,
    setEditingPostId,
    editDraft,
    setEditDraft,
    postEditSaving,
    handleDeletePost,
    handleSavePostEdit,
    handleLike,
    tryInteraction,
    likedPostIds,
    postScoresById,
    openedReplyPosts,
    toggleReplyPanel,
    setInlineReplyPostId,
    setReplyParentReplyId,
    repliesByPost,
    partitionByPost,
    editingReplyId,
    editReplyDraft,
    replyEditSaving,
    replyScoresById,
    stableOnEditDraftChange,
    stableOnStartEditReply,
    stableOnCancelEditReply,
    stableOnSaveReplyEdit,
    stableOnDeleteReply,
    likedReplyIds,
    stableOnToggleLikeReply,
    replyComposerPostId,
    replyParentReplyId,
    stableOnReplyBubble,
  } = props;

  const name = displayTimelineName(
    post.users?.nickname,
    post.users?.public_id
  );

  const postImg = getPostImagePublicUrl(supabase, post.image_storage_path);

  const postScore = effectiveScoreForViewerToxicityFilter(
    post.moderation_max_score
  );
  const postThreshold = userId
    ? thresholdForLevel(toxicityFilterLevel)
    : ANON_TOXICITY_VIEW_THRESHOLD;
  const isOwnPost = Boolean(userId && post.user_id === userId);
  const shouldFoldPost =
    toxicityOverThresholdBehavior === "fold" &&
    !isOwnPost &&
    postScore > postThreshold &&
    !expandedFoldedPosts.has(post.id);

  return (
    <li
      key={post.id}
      className="break-words rounded-lg border border-gray-200 bg-white p-4"
    >
      <div className="mb-1 flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {post.user_id ? (
            post.users?.public_id ? (
              <Link
                href={`/@${post.users.public_id}`}
                className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-800 hover:text-blue-800"
              >
                <UserAvatar
                  name={name}
                  avatarUrl={post.users?.avatar_url ?? null}
                  placeholderHex={post.users?.avatar_placeholder_hex ?? null}
                />
                <span className="line-clamp-2 min-w-0 flex-1 break-words underline decoration-blue-200 underline-offset-2">
                  {name}
                </span>
              </Link>
            ) : (
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-800">
                <UserAvatar
                  name={name}
                  avatarUrl={post.users?.avatar_url ?? null}
                  placeholderHex={post.users?.avatar_placeholder_hex ?? null}
                />
                <span className="line-clamp-2 min-w-0 flex-1 break-words">
                  {name}
                </span>
              </div>
            )
          ) : (
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-800">
              <UserAvatar
                name={name}
                avatarUrl={post.users?.avatar_url ?? null}
                placeholderHex={post.users?.avatar_placeholder_hex ?? null}
              />
              <span className="line-clamp-2 min-w-0 flex-1 break-words">
                {name}
              </span>
            </div>
          )}
        </div>
        {canInteract && userId && post.user_id && post.user_id === userId ? (
          <button
            type="button"
            onClick={() =>
              void handleDeletePost(post.id, post.image_storage_path)
            }
            className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-700 hover:bg-red-100"
          >
            削除
          </button>
        ) : null}
      </div>
      <div className="mb-1 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm text-gray-500">
        <span className="min-w-0">
          {post.created_at ? new Date(post.created_at).toLocaleString() : ""}
        </span>
        {canInteract &&
        userId &&
        post.user_id &&
        post.user_id === userId &&
        canEditOwnPost(post.created_at, userId, post.user_id) ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {/*
              「編集残り MM:SS」の常時表示は廃止。編集フォームを開いた
              時だけ下の EditCountdownBadge で表示する。
              詳細は home/page.tsx の同等ブロックのコメント参照。
            */}
            {editingPostId === post.id ? (
              <button
                type="button"
                onClick={() => setEditingPostId(null)}
                className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-800 hover:bg-gray-50"
              >
                編集取消
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditingPostId(post.id);
                  setEditDraft(post.pending_content ?? post.content);
                }}
                className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-800 hover:bg-gray-50"
              >
                編集
              </button>
            )}
          </div>
        ) : null}
      </div>
      {postImg ? (
        <div className="mt-2 overflow-hidden rounded-md border border-gray-100 bg-gray-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={postImg}
            alt=""
            className="max-h-96 w-full object-contain"
            loading="lazy"
          />
        </div>
      ) : null}
      {shouldFoldPost ? (
        <div className="mt-2 rounded-md border border-amber-100 bg-amber-50/60 px-3 py-2 text-sm text-amber-950">
          <button
            type="button"
            onClick={() =>
              setExpandedFoldedPosts((prev) => {
                const next = new Set(prev);
                next.add(post.id);
                return next;
              })
            }
            className="text-left text-sm font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
          >
            表示制限中（タップで展開）
          </button>
        </div>
      ) : editingPostId === post.id ? (
        <div className="mt-1 space-y-2">
          <AutosizeTextarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            maxRows={14}
            maxLength={POST_AND_REPLY_MAX_CHARS}
            disabled={postEditSaving}
            className="min-h-[2.75rem] w-full resize-none overflow-hidden rounded-2xl border border-gray-300 bg-white px-3 py-2 text-sm leading-snug outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:opacity-50"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={postEditSaving}
              onClick={() => void handleSavePostEdit(post.id)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {postEditSaving ? "保存中…" : "保存"}
            </button>
            <EditCountdownBadge createdAt={post.created_at} />
          </div>
        </div>
      ) : (
        <div className="mt-1 whitespace-pre-wrap break-words">
          {renderTextWithLinks(
            resolvePendingVisibleContent(
              post.content,
              post.pending_content,
              post.created_at
            )
          )}
        </div>
      )}
      {postScoresById[post.id]?.first || postScoresById[post.id]?.second ? (
        <div className="mt-1 space-y-1 rounded border border-gray-100 bg-gray-50/80 px-2 py-1">
          {postScoresById[post.id]?.first ? (
            <ModerationCompactRow scores={postScoresById[post.id]!.first!} />
          ) : null}
          {postScoresById[post.id]?.second ? (
            <ModerationCompactRow scores={postScoresById[post.id]!.second!} />
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!(userId && post.user_id && post.user_id === userId) ? (
          (() => {
            const liked = canInteract && likedPostIds.has(post.id);
            return (
              <button
                type="button"
                onClick={() => {
                  if (!tryInteraction()) return;
                  void handleLike(post.id);
                }}
                className={[
                  "inline-flex items-center gap-2 rounded-md border px-3 py-1 text-sm font-medium transition-colors",
                  liked
                    ? "border-pink-300 bg-pink-50 text-pink-700"
                    : "border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
                ].join(" ")}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={liked ? "text-pink-600" : "text-gray-400"}
                  aria-hidden="true"
                >
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
                スキ
              </button>
            );
          })()
        ) : null}
        <button
          type="button"
          onClick={() => {
            const opened = openedReplyPosts.has(post.id);
            if (!opened) {
              toggleReplyPanel(post.id);
              setInlineReplyPostId(post.id);
              setReplyParentReplyId(null);
              return;
            }
            setInlineReplyPostId(post.id);
            setReplyParentReplyId(null);
          }}
          className={[
            "inline-flex items-center justify-center rounded-md border p-2 hover:opacity-90",
            (repliesByPost[post.id]?.length ?? 0) > 0
              ? "border-sky-300 bg-sky-100 text-sky-800"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
          ].join(" ")}
          aria-label="返信"
          title="返信"
        >
          <ReplyBubbleIcon
            className={
              (repliesByPost[post.id]?.length ?? 0) > 0
                ? "text-sky-700"
                : "text-gray-600"
            }
          />
        </button>
      </div>
      {openedReplyPosts.has(post.id) ? (
        <div className="mt-3 border-t border-gray-100 pt-3 text-sm">
          {(() => {
            const parted = partitionByPost[post.id];
            if (!parted) return null;
            return (
              <ReplyThread
                roots={parted.roots}
                childrenByParent={parted.childrenByParent}
                userId={userId}
                canInteract={canInteract}
                editingReplyId={editingReplyId}
                editReplyDraft={editReplyDraft}
                replyEditSaving={replyEditSaving}
                replyVisibilityThreshold={
                  userId
                    ? thresholdForLevel(toxicityFilterLevel)
                    : ANON_TOXICITY_VIEW_THRESHOLD
                }
                overThresholdBehavior={toxicityOverThresholdBehavior}
                replyScoresById={replyScoresById}
                onEditDraftChange={stableOnEditDraftChange}
                onStartEdit={stableOnStartEditReply}
                onCancelEdit={stableOnCancelEditReply}
                onSaveEdit={stableOnSaveReplyEdit}
                onDelete={stableOnDeleteReply}
                likedReplyIds={likedReplyIds}
                onToggleLikeReply={stableOnToggleLikeReply}
                activeReplyTargetId={
                  replyComposerPostId === post.id ? replyParentReplyId : null
                }
                onReplyBubble={stableOnReplyBubble}
              />
            );
          })()}
        </div>
      ) : null}
    </li>
  );
}
