"use client";

import Link from "next/link";
import React from "react";
import { ModerationCompactRow } from "@/components/moderation-compact-row";
import { UserAvatar } from "@/components/user-avatar";
import {
  canEditOwnReply,
  formatRemainingLabel,
  getEditRemainingMs,
  resolvePendingVisibleContent,
} from "@/lib/post-edit-window";

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
  } | null;
};

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
  /** 閲覧者のリプ許容度（この値以上なら他人から本文を隠す） */
  replyVisibilityThreshold: number;
  replyScoresById: Record<
    number,
    { first?: Record<string, number>; second?: Record<string, number> }
  >;
  onEditDraftChange: (v: string) => void;
  onStartEdit: (r: PostReplyRow) => void;
  onCancelEdit: () => void;
  onSaveEdit: (replyId: number) => void;
  onDelete: (replyId: number) => void;
  onReplyToReply: (parentReplyId: number) => void;
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
  replyScoresById,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReplyToReply,
}: ItemProps) {
  const kids = childrenByParent[reply.id] ?? [];
  const showEdit = canEditOwnReply(reply.created_at, userId, reply.user_id);
  const remainingLabel = formatRemainingLabel(getEditRemainingMs(reply.created_at));

  const isAuthor = userId != null && userId === reply.user_id;
  const maxScore =
    typeof reply.moderation_max_score === "number" ? reply.moderation_max_score : 0;
  const hideReplyBody =
    !isAuthor && maxScore >= replyVisibilityThreshold;

  const replyScores = replyScoresById[reply.id];
  const hasDevScores =
    (replyScores?.first &&
      Object.keys(replyScores.first).length > 0) ||
    (replyScores?.second &&
      Object.keys(replyScores.second).length > 0);
  return (
    <li
      className={[
        "rounded-md bg-gray-50/80 px-2 py-2",
        depth > 0 ? "ml-1 border-l-2 border-gray-200 pl-3" : "",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 text-xs text-gray-600">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {reply.user_id ? (
            <Link
              href={`/home/${reply.user_id}`}
              className="flex min-w-0 items-center gap-1 font-medium text-gray-800 hover:text-blue-800"
            >
              <UserAvatar
                name={reply.users?.nickname ?? null}
                avatarUrl={reply.users?.avatar_url ?? null}
                placeholderHex={reply.users?.avatar_placeholder_hex ?? null}
              />
              <span className="truncate">
                {reply.users?.nickname ?? "（未設定）"}
              </span>
            </Link>
          ) : null}
          <span className="text-gray-400">
            {reply.created_at
              ? new Date(reply.created_at).toLocaleString()
              : ""}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {showEdit ? (
            <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">
              編集残り {remainingLabel}
            </span>
          ) : null}
          {canInteract ? (
            <button
              type="button"
              onClick={() => onReplyToReply(reply.id)}
              className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-800 hover:bg-gray-50"
            >
              返信
            </button>
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
          <textarea
            value={editReplyDraft}
            onChange={(e) => onEditDraftChange(e.target.value)}
            rows={4}
            maxLength={2000}
            disabled={replyEditSaving}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
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
      ) : hideReplyBody ? (
        <p className="mt-1 text-sm italic text-gray-500">
          この返信は、攻撃性の可能性があるため表示を控えています。
        </p>
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
              replyScoresById={replyScoresById}
              onEditDraftChange={onEditDraftChange}
              onStartEdit={onStartEdit}
              onCancelEdit={onCancelEdit}
              onSaveEdit={onSaveEdit}
              onDelete={onDelete}
              onReplyToReply={onReplyToReply}
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
  replyScoresById: Record<
    number,
    { first?: Record<string, number>; second?: Record<string, number> }
  >;
  onEditDraftChange: (v: string) => void;
  onStartEdit: (r: PostReplyRow) => void;
  onCancelEdit: () => void;
  onSaveEdit: (replyId: number) => void;
  onDelete: (replyId: number) => void;
  onReplyToReply: (parentReplyId: number) => void;
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
          replyScoresById={props.replyScoresById}
          onEditDraftChange={props.onEditDraftChange}
          onStartEdit={props.onStartEdit}
          onCancelEdit={props.onCancelEdit}
          onSaveEdit={props.onSaveEdit}
          onDelete={props.onDelete}
          onReplyToReply={props.onReplyToReply}
        />
      ))}
    </ul>
  );
}
