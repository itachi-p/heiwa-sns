"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();
const HOME_MODERATION_THRESHOLD = 0.7;

type Post = {
  id: number;
  content: string;
  created_at?: string;
  user_id?: string;
  users?: { nickname: string | null; avatar_url?: string | null } | null;
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

function getAvatarLabel(name: string | null | undefined) {
  const value = (name ?? "").trim();
  if (!value) return "?";
  return value[0]!.toUpperCase();
}

function Avatar({
  name,
  avatarUrl,
}: {
  name: string | null | undefined;
  avatarUrl?: string | null;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name ? `${name}のアイコン` : "ユーザーアイコン"}
        className="h-8 w-8 shrink-0 rounded-full border border-blue-100 object-cover"
      />
    );
  }
  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
      {getAvatarLabel(name)}
    </span>
  );
}

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [profileNickname, setProfileNickname] = useState<string | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [moderationMode, setModerationMode] = useState<"mock" | "perspective">(
    "mock"
  );
  const [blockOnSubmit, setBlockOnSubmit] = useState(true);
  const [blockThreshold, setBlockThreshold] = useState(HOME_MODERATION_THRESHOLD);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const userId = user?.id ?? null;
  const joinedAtLabel =
    user?.created_at != null
      ? new Date(user.created_at).toLocaleDateString("ja-JP")
      : null;

  async function ensurePublicUserRow(u: User) {
    const { error } = await supabase.from("users").upsert(
      {
        id: u.id,
        email: u.email ?? "",
      },
      { onConflict: "id" }
    );
    if (error) console.warn("ensurePublicUserRow:", error.message);
  }

  const fetchOwnPosts = async (uid: string) => {
    const { data: rows, error } = await supabase
      .from("posts")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("nickname, avatar_url")
      .eq("id", uid)
      .maybeSingle();

    if (profileError) {
      setErrorMessage(profileError.message);
      return;
    }

    const nickname = profile?.nickname ?? null;
    const avatarUrl = profile?.avatar_url ?? null;
    const merged = ((rows ?? []) as Post[]).map((p) => ({
      ...p,
      users: { nickname, avatar_url: avatarUrl },
    }));

    setPosts(merged);
    setProfileNickname(nickname);
    setProfileAvatarUrl(avatarUrl);
    setErrorMessage(null);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId || !user) {
      setProfileReady(false);
      setProfileNickname(null);
      setPosts([]);
      return;
    }

    setProfileReady(false);
    void (async () => {
      await ensurePublicUserRow(user);
      await fetchOwnPosts(userId);
      setProfileReady(true);
    })();
  }, [userId, user]);

  const signOut = async () => {
    setErrorMessage(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setPosts([]);
    setProfileNickname(null);
    setProfileAvatarUrl(null);
    setProfileReady(false);
  };

  const handleDeletePost = async (postId: number) => {
    if (!userId) return;
    const confirmed = window.confirm("この投稿を削除しますか？");
    if (!confirmed) return;

    const { error } = await supabase
      .from("posts")
      .delete()
      .eq("id", postId)
      .eq("user_id", userId);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setPosts((prev) => prev.filter((p) => p.id !== postId));
    setErrorMessage(null);
  };

  const handleSubmitPost = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId) return;
    const content = draft.trim();
    if (!content) return;

    setSubmitting(true);
    setErrorMessage(null);

    const moderationRes = await fetch("/api/moderate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: content,
        mode: moderationMode,
      }),
    });
    const moderationJson = (await moderationRes.json().catch(() => null)) as
      | { overallMax?: number; error?: string }
      | null;
    if (!moderationRes.ok) {
      setErrorMessage(moderationJson?.error ?? "AI判定に失敗しました。");
      setSubmitting(false);
      return;
    }

    if (
      blockOnSubmit &&
      typeof moderationJson?.overallMax === "number" &&
      moderationJson.overallMax >= blockThreshold
    ) {
      setErrorMessage(
        `AI判定スコアが高いため投稿を保留しました（max=${moderationJson.overallMax.toFixed(
          3
        )}）。`
      );
      setSubmitting(false);
      return;
    }

    const { error } = await supabase
      .from("posts")
      .insert({ content, user_id: userId });

    if (error) {
      setErrorMessage(error.message);
      setSubmitting(false);
      return;
    }

    setDraft("");
    setComposeOpen(false);
    await fetchOwnPosts(userId);
    setSubmitting(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!userId) return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorMessage("画像ファイルを選択してください。");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setErrorMessage("画像サイズは2MB以下にしてください。");
      return;
    }

    setAvatarUploading(true);
    setErrorMessage(null);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userId}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });
    if (uploadError) {
      setErrorMessage(uploadError.message);
      setAvatarUploading(false);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(path);
    const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;

    const { error: updateError } = await supabase
      .from("users")
      .update({ avatar_url: cacheBustedUrl })
      .eq("id", userId);
    if (updateError) {
      setErrorMessage(updateError.message);
      setAvatarUploading(false);
      return;
    }

    setProfileAvatarUrl(cacheBustedUrl);
    await fetchOwnPosts(userId);
    setAvatarUploading(false);
    e.target.value = "";
  };

  return (
    <main className="min-h-screen bg-sky-50 text-gray-900">
      <div className="mx-auto max-w-xl p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">Nagi-SNS（仮名）</h1>
            <p className="mt-1 text-sm text-gray-600">ホーム</p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 text-sm">
            {!authReady ? (
              <span className="text-gray-500">読み込み中…</span>
            ) : userId ? (
              <>
                <span className="flex items-center gap-2">
                  <Avatar name={profileNickname} avatarUrl={profileAvatarUrl} />
                  <span
                    className="max-w-[200px] truncate text-gray-600"
                    title={profileNickname ?? ""}
                  >
                    {profileNickname ?? "ニックネーム未設定"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="rounded border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50"
                >
                  ログアウト
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2 text-sm">
          <Link
            href="/"
            className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50"
          >
            タイムライン
          </Link>
          <span className="rounded bg-blue-100 px-2 py-1 font-medium text-blue-700">
            ホーム
          </span>
        </div>

        {userId && profileReady ? (
          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
            <span className="font-medium">登録日:</span>{" "}
            {joinedAtLabel ?? "不明"}
          </div>
        ) : null}

        {userId && profileReady ? (
          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
            <div className="mb-2 font-medium">プロフィール画像（仮実装）</div>
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name={profileNickname} avatarUrl={profileAvatarUrl} />
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
                <span>{avatarUploading ? "アップロード中..." : "画像を選択"}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  disabled={avatarUploading}
                  onChange={(e) => void handleAvatarUpload(e)}
                />
              </label>
              <span className="text-xs text-gray-500">2MB以下 / PNG JPG WEBP GIF</span>
            </div>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errorMessage}
          </div>
        ) : null}

        {!userId && authReady ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
            ログイン後にホーム（あなたの投稿一覧）を表示します。{" "}
            <Link href="/" className="text-blue-700 underline">
              タイムラインへ戻る
            </Link>
          </div>
        ) : null}

        {userId && !profileReady ? (
          <p className="text-gray-600">ホームを読み込み中…</p>
        ) : null}

        {userId && profileReady ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">
              あなたの投稿（新しい順）
            </h2>
            {composeOpen ? (
              <div className="fixed inset-x-4 bottom-20 z-50 md:inset-x-auto md:right-6 md:w-[34rem]">
                <form
                  onSubmit={handleSubmitPost}
                  className="mb-4 flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
                >
                <details className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-gray-800">
                    AI判定（テスト用）
                  </summary>
                  <div className="mt-3 grid gap-3 text-sm">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                      <label className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap">
                        <span className="shrink-0 text-gray-600">モード</span>
                        <select
                          className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1"
                          value={moderationMode}
                          onChange={(e) =>
                            setModerationMode(
                              e.target.value as "mock" | "perspective"
                            )
                          }
                        >
                          <option value="mock">mock（簡易）</option>
                          <option value="perspective">AI判定</option>
                        </select>
                        {moderationMode === "mock" ? (
                          <span className="min-w-0 flex-1 text-xs font-semibold text-red-700">
                            ※mockモードは特定NGワードのみ検出
                          </span>
                        ) : (
                          <span className="min-w-0 flex-1 text-xs font-semibold text-red-700">
                            ※AI判定は現状1日の使用量上限あり
                          </span>
                        )}
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={blockOnSubmit}
                          onChange={(e) => setBlockOnSubmit(e.target.checked)}
                        />
                        <span className="text-gray-700">
                          スコアが高い場合は投稿を保留（テスト用）
                        </span>
                      </label>
                      <label className="flex items-center gap-2">
                        <span className="text-gray-600">閾値</span>
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={blockThreshold}
                          onChange={(e) =>
                            setBlockThreshold(
                              Math.max(0, Math.min(1, Number(e.target.value)))
                            )
                          }
                          className="w-24 rounded border border-gray-300 bg-white px-2 py-1"
                        />
                      </label>
                    </div>
                  </div>
                </details>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="いまどうしてる？"
                  rows={3}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                />
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
                    onClick={() => {
                      setComposeOpen(false);
                      setDraft("");
                    }}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    キャンセル
                  </button>
                </div>
                </form>
              </div>
            ) : null}

            {posts.length === 0 ? (
              <p className="text-sm text-gray-500">まだあなたの投稿はありません。</p>
            ) : (
              <ul className="space-y-3">
                {posts.map((post) => (
                  <li
                    key={post.id}
                    className="break-words rounded-lg border border-gray-200 bg-white p-4"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                        <Avatar
                          name={post.users?.nickname ?? null}
                          avatarUrl={post.users?.avatar_url ?? null}
                        />
                        <span>{post.users?.nickname ?? "（未設定）"}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeletePost(post.id)}
                        className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                      >
                        削除
                      </button>
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {post.created_at ? new Date(post.created_at).toLocaleString() : ""}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words">
                      {renderTextWithLinks(post.content)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => setComposeOpen((prev) => !prev)}
              className="fixed bottom-5 right-5 z-50 inline-flex h-12 w-12 items-center justify-center rounded-full border border-blue-200 bg-blue-600 text-2xl font-semibold text-white shadow-lg hover:bg-blue-700"
              aria-label="投稿フォームを開く"
              title="投稿"
            >
              {composeOpen ? "×" : "+"}
            </button>
          </section>
        ) : null}
      </div>
    </main>
  );
}

