"use client";

import React, { useEffect, useRef } from "react";
import { POST_AND_REPLY_MAX_CHARS } from "@/lib/compose-text-limits";
import { UserAvatar } from "@/components/user-avatar";

/** 返信ボタン用（Threads の吹き出しに近いアイコン） */
export function ReplyBubbleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

export type ReplyComposerModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  targetNickname: string | null;
  targetAvatarUrl: string | null;
  targetPlaceholderHex: string | null;
  /** 返信先の本文プレビュー（プレーンテキスト） */
  targetPreview: string;
  viewerNickname: string | null;
  viewerAvatarUrl: string | null;
  viewerPlaceholderHex: string | null;
};

export function ReplyComposerModal({
  open,
  onClose,
  onSubmit,
  submitting,
  draft,
  onDraftChange,
  targetNickname,
  targetAvatarUrl,
  targetPlaceholderHex,
  targetPreview,
  viewerNickname,
  viewerAvatarUrl,
  viewerPlaceholderHex,
}: ReplyComposerModalProps) {
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const scrollY = window.scrollY;
    const body = document.body;
    const html = document.documentElement;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyPosition = body.style.position;
    const prevBodyTop = body.style.top;
    const prevBodyWidth = body.style.width;
    const prevHtmlOverscroll = html.style.overscrollBehavior;

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    html.style.overscrollBehavior = "none";

    return () => {
      body.style.overflow = prevBodyOverflow;
      body.style.position = prevBodyPosition;
      body.style.top = prevBodyTop;
      body.style.width = prevBodyWidth;
      html.style.overscrollBehavior = prevHtmlOverscroll;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      draftTextareaRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[58] flex items-end justify-center overflow-hidden overscroll-none bg-black/45 p-0 touch-manipulation sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reply-composer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-fit max-h-[min(88dvh,34rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-xl sm:max-h-[min(85vh,34rem)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2
            id="reply-composer-title"
            className="text-sm font-semibold text-gray-900"
          >
            返信
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
            aria-label="閉じる"
          >
            <span className="text-xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>

        <div className="max-h-[min(50dvh,17rem)] min-h-0 touch-pan-y overflow-y-auto overscroll-contain px-4 py-3 sm:max-h-[min(58vh,20rem)]">
          <div className="flex gap-3 border-b border-gray-100 pb-3">
            <UserAvatar
              name={targetNickname}
              avatarUrl={targetAvatarUrl}
              placeholderHex={targetPlaceholderHex}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">
                {targetNickname ?? "（未設定）"}
              </p>
              <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-sm text-gray-600">
                {targetPreview.trim() ? targetPreview : "（本文なし）"}
              </p>
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <UserAvatar
              name={viewerNickname}
              avatarUrl={viewerAvatarUrl}
              placeholderHex={viewerPlaceholderHex}
            />
            <textarea
              ref={draftTextareaRef}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              rows={1}
              maxLength={POST_AND_REPLY_MAX_CHARS}
              disabled={submitting}
              placeholder="返信を入力…"
              className="min-h-0 min-w-0 flex-1 resize-none rounded-2xl border border-gray-300 bg-white px-3 py-2 text-sm leading-snug text-gray-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:opacity-50"
            />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void onSubmit()}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "送信中…" : "返信する"}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
