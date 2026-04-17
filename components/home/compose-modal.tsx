"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AutosizeTextarea } from "@/components/autosize-textarea";
import { ImageAttachIconButton } from "@/components/image-attach-icon-button";
import {
  preparePostImageForUpload,
  type PreparedPostImage,
} from "@/lib/post-image-storage";

type Props = {
  open: boolean;
  /** 本文の最大文字数（POST_AND_REPLY_MAX_CHARS を親から渡す想定） */
  maxChars: number;
  /**
   * 送信ハンドラ。送信が成功したら `true` を返す。
   * 親側ではここで supabase の insert / モデレーション API / 画像アップロードをまとめて行う。
   * ここで `true` が返ってくればモーダル内の下書き / 画像 / エラーをリセットする。
   */
  onSubmit: (
    text: string,
    image: PreparedPostImage | null
  ) => Promise<boolean>;
  /**
   * 子コンポーネント内部で起きた検証エラーを親のトースト表示機構に伝える。
   * （以前は親の `setComposeFormError` + `setToast` の併走で実現していた。
   *   compose-form-error は UI に描画されていないため、トースト表示だけを引き継ぐ。）
   */
  onValidationError: (message: string) => void;
  onCancel: () => void;
};

/**
 * ホームの投稿コンポーズモーダル。
 *
 * 本文ドラフト / 画像 / 送信中フラグ / フォームエラーはすべてこの子コンポーネント内の
 * ローカル state で管理する。これにより文字入力毎に HomePage 全体が再レンダーされる
 * のを避け、タイムラインや自分ポスト一覧の再描画コストを抑える。
 */
export function ComposeModal({
  open,
  maxChars,
  onSubmit,
  onValidationError,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<PreparedPostImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!image) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(image.blob);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [image]);

  if (!open) return null;

  const resetAll = () => {
    setDraft("");
    setImage(null);
  };

  const handleCancel = () => {
    resetAll();
    onCancel();
  };

  const handleFormSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text && !image) {
      onValidationError("投稿内容を入力してください。");
      return;
    }
    if (!text && image) {
      onValidationError("画像を添付する場合は本文を入力してください。");
      return;
    }
    if (text.length > maxChars) {
      onValidationError(`投稿は${maxChars}文字以内にしてください。`);
      return;
    }
    setSubmitting(true);
    let ok = false;
    try {
      ok = await onSubmit(text, image);
    } finally {
      setSubmitting(false);
    }
    if (ok) {
      resetAll();
    }
  };

  return (
    <div className="touch-manipulation fixed inset-x-4 bottom-20 z-[55] md:inset-x-auto md:right-6 md:w-[34rem]">
      <form
        onSubmit={handleFormSubmit}
        className="touch-manipulation mb-4 flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
      >
        <div className="flex items-end gap-2">
          <AutosizeTextarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="いまどうしてる？"
            maxRows={12}
            maxLength={maxChars}
            disabled={submitting}
            autoComplete="off"
            enterKeyHint="send"
            className="min-h-[2.75rem] min-w-0 flex-1 resize-none overflow-hidden rounded-2xl border border-gray-300 bg-white px-3 py-2 text-base leading-snug outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
          />
          <ImageAttachIconButton
            disabled={submitting}
            onPick={(file) => {
              void (async () => {
                const r = await preparePostImageForUpload(file);
                if (!r.ok) {
                  // 画像の縮小/圧縮や形式チェックで失敗した場合、理由不明のまま
                  // 添付が無視されると利用者は原因が分からないため、
                  // preparePostImageForUpload が返す message をトーストで通知する。
                  onValidationError(r.message);
                  return;
                }
                setImage({
                  blob: r.blob,
                  contentType: r.contentType,
                  ext: r.ext,
                });
              })();
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          {previewUrl ? (
            <div className="flex flex-wrap items-end gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt=""
                className="max-h-40 rounded border border-gray-200 object-contain"
              />
              <button
                type="button"
                disabled={submitting}
                onClick={() => setImage(null)}
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
            disabled={submitting}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? "投稿中..." : "投稿"}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleCancel}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
