"use client";

import React, { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

/**
 * Google OAuth 等で初回のみ。招待コード未登録のときブロッキングモーダル。
 */
export function InviteOnboardingLayer() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
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
        .select("invite_onboarding_completed, must_change_password")
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
      setOpen(!data?.invite_onboarding_completed);
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
    const t = token.trim();
    if (!t) {
      setError("招待コードを入力してください。");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/invite-bind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: t }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(json?.error?.trim() || "登録に失敗しました。");
        return;
      }
      setToken("");
      setOpen(false);
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[52] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-onboarding-title"
    >
      <form
        onSubmit={(ev) => void onSubmit(ev)}
        className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
      >
        <h2
          id="invite-onboarding-title"
          className="text-base font-semibold text-gray-900"
        >
          招待コードを入力
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          先行体験の利用には、お渡しした招待コードが必要です。
        </p>
        {error?.trim() ? (
          <div
            role="alert"
            className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800"
          >
            {error}
          </div>
        ) : null}
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          placeholder="招待コード"
          autoComplete="off"
          autoFocus
        />
        <button
          type="submit"
          disabled={busy}
          className="mt-3 w-full rounded-md bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "確認中…" : "登録する"}
        </button>
      </form>
    </div>
  );
}
