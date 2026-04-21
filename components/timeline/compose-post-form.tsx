import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";

import { AutosizeTextarea } from "@/components/autosize-textarea";
import { ImageAttachIconButton } from "@/components/image-attach-icon-button";
import { POST_AND_REPLY_MAX_CHARS } from "@/lib/compose-text-limits";
import {
  preparePostImageForUpload,
  type PreparedPostImage,
} from "@/lib/post-image-storage";
import type { TimelineToastState } from "@/lib/timeline-types";

export type ComposePostFormProps = {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  composeImagePreviewUrl: string | null;
  setComposePostImage: Dispatch<SetStateAction<PreparedPostImage | null>>;
  postSubmitting: boolean;
  composeTextareaRef: RefObject<HTMLTextAreaElement | null>;
  setComposeOpen: Dispatch<SetStateAction<boolean>>;
  setToast: Dispatch<SetStateAction<TimelineToastState | null>>;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
};

/**
 * タイムライン画面の新規投稿フォーム（`composeOpen` 時に `bottom-20 z-[55]` で表示）。
 * `app/(main)/page.tsx` からそのまま抽出。state・ハンドラはすべて props 経由。
 */
export function ComposePostForm(props: ComposePostFormProps) {
  const {
    input,
    setInput,
    composeImagePreviewUrl,
    setComposePostImage,
    postSubmitting,
    composeTextareaRef,
    setComposeOpen,
    setToast,
    onSubmit,
  } = props;
  return (
    <div className="touch-manipulation fixed inset-x-4 bottom-20 z-[55] md:inset-x-auto md:right-6 md:w-[34rem]">
      <form
        onSubmit={onSubmit}
        className="touch-manipulation flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
      >
        <div className="flex items-end gap-2">
          <AutosizeTextarea
            ref={composeTextareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="いまどうしてる？"
            maxRows={12}
            maxLength={POST_AND_REPLY_MAX_CHARS}
            disabled={postSubmitting}
            autoComplete="off"
            enterKeyHint="send"
            className="min-h-[2.75rem] min-w-0 flex-1 resize-none overflow-hidden rounded-2xl border border-gray-300 bg-white px-3 py-2 text-base leading-snug outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
          />
          <ImageAttachIconButton
            disabled={postSubmitting}
            onPick={(file) => {
              void (async () => {
                const r = await preparePostImageForUpload(file);
                if (!r.ok) {
                  setToast({
                    message:
                      "画像の準備に失敗しました。形式や容量をご確認ください。",
                    tone: "error",
                  });
                  return;
                }
                setComposePostImage({
                  blob: r.blob,
                  contentType: r.contentType,
                  ext: r.ext,
                });
              })();
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          {composeImagePreviewUrl ? (
            <div className="flex flex-wrap items-end gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={composeImagePreviewUrl}
                alt=""
                className="max-h-40 rounded border border-gray-200 object-contain"
              />
              <button
                type="button"
                disabled={postSubmitting}
                onClick={() => setComposePostImage(null)}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                画像を外す
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={postSubmitting}
            className="rounded-md bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {postSubmitting ? "投稿中…" : "投稿"}
          </button>
          <button
            type="button"
            disabled={postSubmitting}
            onClick={() => {
              setComposeOpen(false);
              setInput("");
              setComposePostImage(null);
            }}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
