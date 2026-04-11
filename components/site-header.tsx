"use client";

import React, { useEffect, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();
const AUTH_TIMEOUT_MS = 15000;

function formatAuthError(error: unknown, fallback: string) {
  if (!error) return fallback;
  if (typeof error === "string") {
    const msg = error.trim();
    return msg && msg !== "{}" ? msg : fallback;
  }
  if (error instanceof Error) {
    const msg = error.message?.trim();
    return msg && msg !== "{}" ? msg : fallback;
  }
  if (typeof error === "object") {
    const rec = error as Record<string, unknown>;
    const message = typeof rec.message === "string" ? rec.message.trim() : "";
    const code = typeof rec.code === "string" ? rec.code.trim() : "";
    const status =
      typeof rec.status === "number" ? ` (status: ${rec.status})` : "";
    if (message && message !== "{}") {
      return `${message}${code ? ` [${code}]` : ""}${status}`;
    }
  }
  return fallback;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMessage: string
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={20}
      height={20}
      aria-hidden
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export type SiteHeaderProps = {
  authReady: boolean;
  user: User | null;
  profileNickname: string | null;
  profileAvatarUrl: string | null;
  /** 画像未設定時のプレースホルダー丸の背景 #RRGGBB */
  avatarPlaceholderHex: string | null;
  onSignOut: () => void | Promise<void>;
};

export function SiteHeader({
  authReady,
  user,
  profileNickname,
  profileAvatarUrl,
  avatarPlaceholderHex,
  onSignOut,
}: SiteHeaderProps) {
  const userId = user?.id ?? null;

  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [loginModalBanner, setLoginModalBanner] = useState<{
    variant: "error" | "info";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (userId) setLoginModalOpen(false);
  }, [userId]);

  useEffect(() => {
    if (loginModalOpen) setLoginModalBanner(null);
  }, [loginModalOpen]);

  const closeLoginModal = () => {
    setLoginModalOpen(false);
    setLoginModalBanner(null);
  };

  const signInWithGoogle = async () => {
    setLoginModalBanner(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setLoginModalBanner({ variant: "error", text: error.message });
    }
  };

  const signInWithEmail = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoginModalBanner(null);
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setLoginModalBanner({
        variant: "error",
        text: "メールアドレスとパスワードを入力してください。",
      });
      return;
    }
    if (authMode === "signup" && !inviteToken.trim()) {
      setLoginModalBanner({
        variant: "error",
        text: "招待コードを入力してください。",
      });
      return;
    }

    setAuthSubmitting(true);
    try {
      if (authMode === "signup") {
        const signupRes = await withTimeout(
          fetch("/api/invite-signup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: normalizedEmail,
              password,
              inviteToken: inviteToken.trim(),
            }),
          }),
          AUTH_TIMEOUT_MS,
          "認証リクエストがタイムアウトしました。時間をおいて再試行してください。"
        );
        const signupJson = (await signupRes.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!signupRes.ok) {
          setLoginModalBanner({
            variant: "error",
            text: signupJson?.error?.trim() || "新規登録に失敗しました。",
          });
          return;
        }
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError) {
          setLoginModalBanner({
            variant: "error",
            text: formatAuthError(
              signInError,
              "登録は完了しましたが、ログインに失敗しました。"
            ),
          });
          return;
        }
        setInviteToken("");
        return;
      }

      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        }),
        AUTH_TIMEOUT_MS,
        "認証リクエストがタイムアウトしました。時間をおいて再試行してください。"
      );
      if (error) {
        setLoginModalBanner({
          variant: "error",
          text: formatAuthError(
            error,
            "ログインに失敗しました。時間をおいて再試行してください。"
          ),
        });
      }
    } catch (err) {
      setLoginModalBanner({
        variant: "error",
        text: formatAuthError(
          err,
          "認証処理中にエラーが発生しました。時間をおいて再試行してください。"
        ),
      });
    } finally {
      setAuthSubmitting(false);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-gray-200/90 bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-xl px-4 py-2 sm:max-w-3xl lg:max-w-6xl">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold sm:text-xl">
                Nagi-SNS
              </h1>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-sm">
              {!authReady ? (
                <span className="text-gray-500">読み込み中…</span>
              ) : userId ? (
                <>
                  <span className="flex max-w-[140px] items-center gap-2 sm:max-w-[220px]">
                    <UserAvatar
                      name={profileNickname}
                      avatarUrl={profileAvatarUrl}
                      placeholderHex={avatarPlaceholderHex}
                      size="sm"
                    />
                    <span
                      className="truncate text-gray-600"
                      title={profileNickname ?? ""}
                    >
                      {profileNickname?.trim()
                        ? profileNickname
                        : "未設定"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void onSignOut()}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 sm:text-sm"
                  >
                    ログアウト
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setLoginModalOpen(true)}
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 sm:px-3 sm:text-sm"
                >
                  ログイン・新規登録
                </button>
              )}
            </div>
          </div>
          <p className="mt-1 text-xs leading-snug text-gray-600 sm:text-sm">
            「数」に追われる荒波から、穏やかな支流へ
          </p>
        </div>
      </header>

      {loginModalOpen && !userId && authReady ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="login-modal-title"
          onClick={closeLoginModal}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="login-modal-title"
              className="text-base font-semibold text-gray-900"
            >
              ログイン・新規登録
            </h2>
            {loginModalBanner ? (
              <div
                role="alert"
                className={[
                  "mt-3 rounded-md border p-2 text-sm",
                  loginModalBanner.variant === "error"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-emerald-200 bg-emerald-50 text-emerald-900",
                ].join(" ")}
              >
                {loginModalBanner.text}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white py-2 pl-3 pr-4 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              <GoogleMark className="h-5 w-5 shrink-0" />
              Googleでログイン
            </button>
            <p className="my-3 text-center text-xs text-gray-400">または</p>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setAuthMode("login");
                  setLoginModalBanner(null);
                }}
                className={[
                  "rounded-md border px-3 py-2 text-sm font-medium",
                  authMode === "login"
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
                ].join(" ")}
              >
                ログイン
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode("signup");
                  setLoginModalBanner(null);
                }}
                className={[
                  "rounded-md border px-3 py-2 text-sm font-medium",
                  authMode === "signup"
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
                ].join(" ")}
              >
                新規登録
              </button>
            </div>
            <form onSubmit={signInWithEmail} className="flex flex-col gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                className="rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="パスワード"
                className="rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
              />
              {authMode === "signup" ? (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={inviteToken}
                    onChange={(e) => setInviteToken(e.target.value)}
                    placeholder="招待コード"
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                  />
                  <p className="text-xs text-gray-500">
                    先行体験ユーザー向けのコードが必要です。
                  </p>
                </div>
              ) : null}
              <button
                type="submit"
                disabled={authSubmitting}
                className={[
                  "rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-60",
                  authMode === "login"
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "bg-emerald-600 hover:bg-emerald-700",
                ].join(" ")}
              >
                {authSubmitting
                  ? "処理中..."
                  : authMode === "login"
                    ? "メールでログイン"
                    : "メールで新規登録"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
