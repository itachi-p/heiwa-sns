"use client";

import React, { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  isValidPublicIdFormat,
  normalizePublicId,
  PUBLIC_ID_MAX_LEN,
  publicIdValidationMessage,
} from "@/lib/public-id";

const supabase = createClient();

/**
 * 公開 ID 未設定のログインユーザにブロッキングで入力を求める（初回のみ）。
 */
export function PublicIdRequiredLayer() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled || !session?.user) {
        setOpen(false);
        return;
      }
      const { data, error: qErr } = await supabase
        .from("users")
        .select("public_id, must_change_password, invite_onboarding_completed")
        .eq("id", session.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (qErr) {
        setOpen(false);
        return;
      }
      if (data?.must_change_password) {
        setOpen(false);
        return;
      }
      if (!data?.invite_onboarding_completed) {
        setOpen(false);
        return;
      }
      const pid = data?.public_id;
      setOpen(
        pid == null || (typeof pid === "string" && pid.trim() === "")
      );
    };
    void run();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void run();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = normalizePublicId(draft);
    if (!isValidPublicIdFormat(v)) {
      setError(publicIdValidationMessage());
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/set-public-id", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicId: v }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(json?.error?.trim() || "登録に失敗しました。");
        return;
      }
      setOpen(false);
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="public-id-title"
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="public-id-title"
          className="text-base font-semibold text-gray-900"
        >
          公開IDを設定
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          公開するときのIDです（@の後ろ）。英数字と ._- のみ、5〜20文字。設定後は変更できません。
        </p>
        <div className="mt-3 flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm">
          <span className="text-gray-500">@</span>
          <input
            value={draft}
            onChange={(e) =>
              setDraft(e.target.value.replace(/[\s\r\n]/g, ""))
            }
            className="min-w-0 flex-1 bg-transparent outline-none"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={PUBLIC_ID_MAX_LEN}
            placeholder="your-id"
          />
        </div>
        {error ? (
          <p className="mt-2 text-sm text-red-700">{error}</p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-md bg-sky-600 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-60"
        >
          {busy ? "登録中…" : "決定"}
        </button>
      </form>
    </div>
  );
}
