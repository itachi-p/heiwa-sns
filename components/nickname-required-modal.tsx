"use client";

import React, { type FormEvent } from "react";

type NicknameRequiredModalProps = {
  open: boolean;
  nicknameDraft: string;
  onNicknameDraftChange: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  /** バリデーション・DB エラーなど（モーダル内表示） */
  errorMessage?: string | null;
};

/** ログイン直後・ニックネーム未設定時のみ。閉じる操作なし（ログアウトはヘッダー） */
export function NicknameRequiredModal({
  open,
  nicknameDraft,
  onNicknameDraftChange,
  onSubmit,
  errorMessage,
}: NicknameRequiredModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[51] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nickname-required-title"
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
      >
        <h2
          id="nickname-required-title"
          className="text-base font-semibold text-gray-900"
        >
          ニックネームを設定
        </h2>
        <p className="mt-2 text-sm text-gray-700">
          はじめにニックネームを設定してください（1〜20文字・改行不可）。
        </p>
        {errorMessage?.trim() ? (
          <div
            role="alert"
            className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800"
          >
            {errorMessage}
          </div>
        ) : null}
        <input
          value={nicknameDraft}
          onChange={(e) =>
            onNicknameDraftChange(e.target.value.replace(/[\n\r]/g, ""))
          }
          maxLength={20}
          placeholder="ニックネーム"
          className="mt-3 w-full rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          autoComplete="nickname"
          autoFocus
        />
        <button
          type="submit"
          className="mt-3 w-full rounded-md bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700"
        >
          保存してはじめる
        </button>
      </form>
    </div>
  );
}
