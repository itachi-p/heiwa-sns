"use client";

import Link from "next/link";
import React, { useState } from "react";
import { AutosizeTextarea } from "@/components/autosize-textarea";
import { ReplyBubbleIcon } from "@/components/reply-composer-modal";
import { ModerationCompactRow } from "@/components/moderation-compact-row";
import { UserAvatar } from "@/components/user-avatar";
import {
  canEditOwnReply,
  formatRemainingLabel,
  getEditRemainingMs,
  resolvePendingVisibleContent,
} from "@/lib/post-edit-window";
import { POST_AND_REPLY_MAX_CHARS } from "@/lib/compose-text-limits";
import {
  effectiveScoreForViewerToxicityFilter,
  type ToxicityOverThresholdBehavior,
} from "@/lib/toxicity-filter-level";

export type PostReplyRow = {
  id: number;
  post_id: number;
  user_id: string;
  content: string;
  pending_content?: string | null;
  created_at?: string;
  parent_reply_id?: number | null;
  /** DB のみ。5指標はクライアントの replyScoresById */
  moderation_max_score?: number;
  users?: {
    nickname: string | null;
    avatar_url?: string | null;
    avatar_placeholder_hex?: string | null;
    public_id?: string | null;
  } | null;
};

function displayName(
  nickname: string | null | undefined,
  publicId: string | null | undefined
): string {
  const nick = (nickname ?? "").trim();
  if (nick) return nick;
  const pid = (publicId ?? "").trim();
  return pid || "（未設定）";
}

function renderTextWithLinks(text: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const isUrl = /^https?:\/\/[^\s]+$/;
  return text.split(urlRegex).map((part, idx) => {
    if (isUrl.test(part)) {
      return (
        <a
          key={`${part}-${idx}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-blue-300 underline-offset-2 hover:text-blue-700"
        >
          {part}
        </a>
      );
    }
    return <React.Fragment key={`${part}-${idx}`}>{part}</React.Fragment>;
  });
}

type ItemProps = {
  reply: PostReplyRow;
  depth: number;
  childrenByParent: Record<number, PostReplyRow[]>;
  userId: string | null;
  canInteract: boolean;
  nowTick: number;
  editingReplyId: number | null;
  editReplyDraft: string;
  replyEditSaving: boolean;
  /** 閲覧者の攻撃性フィルタ閾値（この値を超える他人の返信は折りたたみ） */
  replyVisibilityThreshold: number;
  overThresholdBehavior: ToxicityOverThresholdBehavior;
  replyScoresById: Record<
    number,
    { first?: Record<string, number>; second?: Record<string, number> }
  >;
  onEditDraftChange: (v: string) => void;
  onStartEdit: (r: PostReplyRow) => void;
  onCancelEdit: () => void;
  onSaveEdit: (replyId: number) => void;
  onDelete: (replyId: number) => void;
  likedReplyIds: Set<number>;
  onToggleLikeReply: (replyId: number) => void;
  activeReplyTargetId: number | null;
  onReplyBubble: (reply: PostReplyRow) => void;
};

function ReplyItem({
  reply,
  depth,
  childrenByParent,
  userId,
  canInteract,
  nowTick,
  editingReplyId,
  editReplyDraft,
  replyEditSaving,
  replyVisibilityThreshold,
  overThresholdBehavior,
  replyScoresById,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  likedReplyIds,
  onToggleLikeReply,
  activeReplyTargetId,
  onReplyBubble,
}: ItemProps) {
  const name = displayName(reply.users?.nickname, reply.users?.public_id);
  const [foldExpanded, setFoldExpanded] = useState(false);
  const kids = childrenByParent[reply.id] ?? [];
  const showEdit = canEditOwnReply(reply.created_at, userId, reply.user_id);
  const remainingLabel = formatRemainingLabel(getEditRemainingMs(reply.created_at));

  const isAuthor = userId != null && userId === reply.user_id;
  const maxScore = effectiveScoreForViewerToxicityFilter(
    reply.moderation_max_score
  );
  const replyFolded =
    !isAuthor && maxScore > replyVisibilityThreshold;
  if (replyFolded && overThresholdBehavior === "hide") {
    return null;
  }

  const replyScores = replyScoresById[reply.id];
  const hasDevScores =
    (replyScores?.first &&
      Object.keys(replyScores.first).length > 0) ||
    (replyScores?.second &&
      Object.keys(replyScores.second).length > 0);
  const liked = likedReplyIds.has(reply.id);
  const bubbleActive = activeReplyTargetId === reply.id;
  const hasChildren = kids.length > 0;
  return (
    <li
      className={[
        "relative rounded-md bg-gray-50/80 px-2 py-2",
        depth > 0 ? "ml-1 border-l-2 border-gray-200 pl-3" : "",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start gap-2 pr-28 text-xs text-gray-600">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {reply.user_id ? (
            reply.users?.public_id ? (
            <Link
              href={`/@${reply.users.public_id}`}
              className="flex min-w-0 items-center gap-1 font-medium text-gray-800 hover:text-blue-800"
            >
              <UserAvatar
                name={name}
                avatarUrl={reply.users?.avatar_url ?? null}
                placeholderHex={reply.users?.avatar_placeholder_hex ?? null}
              />
              <span className="truncate">
                {name}
              </span>
            </Link>
            ) : (
            <span className="flex min-w-0 items-center gap-1 font-medium text-gray-800">
              <UserAvatar
                name={name}
                avatarUrl={reply.users?.avatar_url ?? null}
                placeholderHex={reply.users?.avatar_placeholder_hex ?? null}
              />
              <span className="truncate">
                {name}
              </span>
            </span>
            )
          ) : null}
          <span className="text-gray-400">
            {reply.created_at
              ? new Date(reply.created_at).toLocaleString()
              : ""}
          </span>
        </div>
        <div className="absolute right-2 top-2 flex shrink-0 flex-wrap items-center gap-1">
          {showEdit ? (
            <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">
              編集残り {remainingLabel}
            </span>
          ) : null}
          {showEdit ? (
            editingReplyId === reply.id ? (
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-800 hover:bg-gray-50"
              >
                編集をやめる
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onStartEdit(reply)}
                className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-800 hover:bg-gray-50"
              >
                編集
              </button>
            )
          ) : null}
          {canInteract && userId === reply.user_id ? (
            <button
              type="button"
              onClick={() => void onDelete(reply.id)}
              className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
            >
              削除
            </button>
          ) : null}
        </div>
      </div>
      {editingReplyId === reply.id ? (
        <div className="mt-2 space-y-2">
          <AutosizeTextarea
            value={editReplyDraft}
            onChange={(e) => onEditDraftChange(e.target.value)}
            maxRows={10}
            maxLength={POST_AND_REPLY_MAX_CHARS}
            disabled={replyEditSaving}
            className="min-h-[2.75rem] w-full resize-none overflow-hidden rounded-2xl border border-gray-300 bg-white px-3 py-2 text-sm leading-snug text-gray-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:opacity-50"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={replyEditSaving}
              onClick={() => void onSaveEdit(reply.id)}
              className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {replyEditSaving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      ) : replyFolded && !foldExpanded ? (
        <div className="mt-1 rounded-md border border-amber-100 bg-amber-50/60 px-2 py-1.5 text-sm text-amber-950">
          <button
            type="button"
            onClick={() => setFoldExpanded(true)}
            className="w-full text-left text-sm font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
          >
            表示制限中（タップで展開）
          </button>
        </div>
      ) : (
        <div className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800">
          {renderTextWithLinks(
            resolvePendingVisibleContent(
              reply.content,
              reply.pending_content,
              reply.created_at,
              nowTick
            )
          )}
        </div>
      )}
      {hasDevScores ? (
        <div className="mt-1 space-y-1 rounded border border-gray-100 bg-gray-50/80 px-2 py-1">
          {replyScores?.first &&
          Object.keys(replyScores.first).length > 0 ? (
            <ModerationCompactRow scores={replyScores.first} />
          ) : null}
          {replyScores?.second &&
          Object.keys(replyScores.second).length > 0 ? (
            <ModerationCompactRow scores={replyScores.second} />
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onToggleLikeReply(reply.id)}
          className={[
            "inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
            liked
              ? "border-pink-300 bg-pink-50 text-pink-700"
              : "border-gray-300 bg-white text-gray-500 hover:bg-gray-50",
          ].join(" ")}
          aria-label="返信にスキ"
          title="返信にスキ"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onReplyBubble(reply)}
          className={[
            "inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
            bubbleActive
              ? "border-sky-300 bg-sky-50 text-sky-700"
              : hasChildren
                ? "border-sky-200 bg-sky-50/70 text-sky-700 hover:bg-sky-100"
                : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50",
          ].join(" ")}
          aria-label="返信先にする"
          title="返信"
        >
          <ReplyBubbleIcon className="h-4 w-4" />
        </button>
      </div>
      {kids.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {kids.map((c) => (
            <ReplyItem
              key={c.id}
              reply={c}
              depth={depth + 1}
              childrenByParent={childrenByParent}
              userId={userId}
              canInteract={canInteract}
              nowTick={nowTick}
              editingReplyId={editingReplyId}
              editReplyDraft={editReplyDraft}
              replyEditSaving={replyEditSaving}
              replyVisibilityThreshold={replyVisibilityThreshold}
              overThresholdBehavior={overThresholdBehavior}
              replyScoresById={replyScoresById}
              onEditDraftChange={onEditDraftChange}
              onStartEdit={onStartEdit}
              onCancelEdit={onCancelEdit}
              onSaveEdit={onSaveEdit}
              onDelete={onDelete}
              likedReplyIds={likedReplyIds}
              onToggleLikeReply={onToggleLikeReply}
              activeReplyTargetId={activeReplyTargetId}
              onReplyBubble={onReplyBubble}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

type ThreadProps = {
  roots: PostReplyRow[];
  childrenByParent: Record<number, PostReplyRow[]>;
  userId: string | null;
  canInteract: boolean;
  nowTick: number;
  editingReplyId: number | null;
  editReplyDraft: string;
  replyEditSaving: boolean;
  replyVisibilityThreshold: number;
  overThresholdBehavior: ToxicityOverThresholdBehavior;
  replyScoresById: Record<
    number,
    { first?: Record<string, number>; second?: Record<string, number> }
  >;
  onEditDraftChange: (v: string) => void;
  onStartEdit: (r: PostReplyRow) => void;
  onCancelEdit: () => void;
  onSaveEdit: (replyId: number) => void;
  onDelete: (replyId: number) => void;
  likedReplyIds: Set<number>;
  onToggleLikeReply: (replyId: number) => void;
  activeReplyTargetId: number | null;
  onReplyBubble: (reply: PostReplyRow) => void;
};

export function ReplyThread(props: ThreadProps) {
  return (
    <ul className="space-y-2">
      {props.roots.map((r) => (
        <ReplyItem
          key={r.id}
          reply={r}
          depth={0}
          childrenByParent={props.childrenByParent}
          userId={props.userId}
          canInteract={props.canInteract}
          nowTick={props.nowTick}
          editingReplyId={props.editingReplyId}
          editReplyDraft={props.editReplyDraft}
          replyEditSaving={props.replyEditSaving}
          replyVisibilityThreshold={props.replyVisibilityThreshold}
          overThresholdBehavior={props.overThresholdBehavior}
          replyScoresById={props.replyScoresById}
          onEditDraftChange={props.onEditDraftChange}
          onStartEdit={props.onStartEdit}
          onCancelEdit={props.onCancelEdit}
          onSaveEdit={props.onSaveEdit}
          onDelete={props.onDelete}
          likedReplyIds={props.likedReplyIds}
          onToggleLikeReply={props.onToggleLikeReply}
          activeReplyTargetId={props.activeReplyTargetId}
          onReplyBubble={props.onReplyBubble}
        />
      ))}
    </ul>
  );
}
