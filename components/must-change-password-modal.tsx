"use client";

import React, { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { validateMandatoryNewPassword } from "@/lib/invite-password";

const supabase = createClient();

type MustChangePasswordModalProps = {
  open: boolean;
  userId: string | null;
  /** 変更後に表示する識別用ラベル（あれば） */
  inviteLabel: string | null;
  onCompleted: () => void;
};

/** 初回ログイン・貸与アカウント用。閉じる操作なし */
export function MustChangePasswordModal({
  open,
  userId,
  inviteLabel,
  onCompleted,
}: MustChangePasswordModalProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open || !userId) return null;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);

    if (password !== confirm) {
      setErrorMessage("確認用と一致しません。");
      return;
    }

    const validated = validateMandatoryNewPassword(password);
    if (!validated.ok) {
      setErrorMessage(validated.message);
      return;
    }

    setSubmitting(true);
    try {
      const { error: authErr } = await supabase.auth.updateUser({
        password: validated.value,
      });
      if (authErr) {
        setErrorMessage(authErr.message?.trim() || "パスワードの更新に失敗しました。");
        return;
      }

      const { error: dbErr } = await supabase
        .from("users")
        .update({ must_change_password: false })
        .eq("id", userId);

      if (dbErr) {
        setErrorMessage(
          dbErr.message?.trim() ||
            "パスワードは更新されましたが、プロフィールの状態更新に失敗しました。再読み込みしてください。"
        );
        return;
      }

      setPassword("");
      setConfirm("");
      onCompleted();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[53] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="must-change-password-title"
    >
      <form
        onSubmit={(ev) => void handleSubmit(ev)}
        className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
      >
        <h2
          id="must-change-password-title"
          className="text-base font-semibold text-gray-900"
        >
          パスワードを変更
        </h2>
        <p className="mt-2 text-sm text-gray-700">
          セキュリティのため、新しいパスワードを設定してください（8文字以上・英字と数字を含む）。
        </p>
        {inviteLabel?.trim() ? (
          <p className="mt-2 text-xs text-gray-600">
            識別コード: <span className="font-mono font-medium">{inviteLabel}</span>
          </p>
        ) : null}
        {errorMessage?.trim() ? (
          <div
            role="alert"
            className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800"
          >
            {errorMessage}
          </div>
        ) : null}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          placeholder="新しいパスワード"
          className="mt-3 w-full rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          autoFocus
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          placeholder="確認用"
          className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
        />
        <button
          type="submit"
          disabled={submitting}
          className="mt-3 w-full rounded-md bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "保存中…" : "保存して続ける"}
        </button>
      </form>
    </div>
  );
}
