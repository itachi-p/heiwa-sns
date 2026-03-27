"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import type { PostgrestError, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { validateNickname } from "@/lib/nickname";

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
  size = "sm",
}: {
  name: string | null | undefined;
  avatarUrl?: string | null;
  size?: "sm" | "lg";
}) {
  const sizeClass =
    size === "lg"
      ? "h-24 w-24 text-2xl"
      : "h-8 w-8 text-xs";
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name ? `${name}のアイコン` : "ユーザーアイコン"}
        className={`${sizeClass} shrink-0 rounded-full border border-blue-100 object-cover`}
      />
    );
  }
  return (
    <span
      className={`inline-flex ${sizeClass} shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700`}
    >
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
  const [profileBio, setProfileBio] = useState("");
  const [profileInterests, setProfileInterests] = useState("");
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [interestsDraft, setInterestsDraft] = useState("");
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
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
      .select("nickname, avatar_url, bio, interests")
      .eq("id", uid)
      .maybeSingle();

    if (profileError) {
      setErrorMessage(profileError.message);
      return;
    }

    const nickname = profile?.nickname ?? null;
    const avatarUrl = profile?.avatar_url ?? null;
    const bio = profile?.bio ?? "";
    const interests = profile?.interests ?? "";
    const merged = ((rows ?? []) as Post[]).map((p) => ({
      ...p,
      users: { nickname, avatar_url: avatarUrl },
    }));

    setPosts(merged);
    setProfileNickname(nickname);
    setProfileAvatarUrl(avatarUrl);
    setProfileBio(bio);
    setProfileInterests(interests);
    setNicknameDraft(nickname ?? "");
    setBioDraft(bio);
    setInterestsDraft(interests);
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
    setProfileBio("");
    setProfileInterests("");
    setNicknameDraft("");
    setBioDraft("");
    setInterestsDraft("");
    setProfileEditOpen(false);
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

  const handleProfileSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId) return;

    const result = validateNickname(nicknameDraft);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }

    setProfileSaving(true);
    setErrorMessage(null);
    const { error } = await supabase
      .from("users")
      .update({
        nickname: result.value,
        bio: bioDraft.trim(),
        interests: interestsDraft.trim(),
      })
      .eq("id", userId);

    if (error) {
      const pgErr = error as PostgrestError;
      if (pgErr.code === "23505") {
        setErrorMessage("そのニックネームは既に使われています。");
      } else {
        setErrorMessage(error.message);
      }
      setProfileSaving(false);
      return;
    }

    setProfileNickname(result.value);
    setProfileBio(bioDraft.trim());
    setProfileInterests(interestsDraft.trim());
    await fetchOwnPosts(userId);
    setProfileSaving(false);
    setProfileEditOpen(false);
  };

  return (
    <main className="min-h-screen bg-sky-50 text-gray-900">
      <div className="mx-auto max-w-xl p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">Nagi-SNS（仮名）</h1>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 text-sm">
            {!authReady ? (
              <span className="text-gray-500">読み込み中…</span>
            ) : userId ? (
              <button
                type="button"
                onClick={() => void signOut()}
                className="rounded border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50"
              >
                ログアウト
              </button>
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
          <section className="mb-4 text-sm text-gray-700">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-3">
                <Avatar
                  name={profileNickname}
                  avatarUrl={profileAvatarUrl}
                  size="lg"
                />
                <div className="min-w-0 space-y-1">
                  <p className="text-lg font-semibold text-gray-800">
                    {profileNickname ?? "ニックネーム未設定"}
                  </p>
                  {profileBio ? (
                    <p className="whitespace-pre-wrap text-sm text-gray-700">
                      {profileBio}
                    </p>
                  ) : null}
                  {profileInterests ? (
                    <p className="text-xs text-gray-600">
                      趣味・関心: {profileInterests}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProfileEditOpen((prev) => !prev)}
                className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                プロフィール編集
              </button>
            </div>
          </section>
        ) : null}

        {profileEditOpen ? (
          <div className="fixed inset-0 z-[70] bg-black/35 p-4">
            <div className="mx-auto mt-10 w-full max-w-xl rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
              <form onSubmit={handleProfileSave} className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-800">
                    プロフィール編集
                  </h3>
                  <p className="text-xs text-gray-500">
                    登録日: {joinedAtLabel ?? "不明"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
                    <Avatar
                      name={profileNickname}
                      avatarUrl={profileAvatarUrl}
                    />
                    <span>{avatarUploading ? "アップロード中..." : "画像を変更"}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      disabled={avatarUploading}
                      onChange={(e) => void handleAvatarUpload(e)}
                    />
                  </label>
                  <span className="text-xs text-gray-500">
                    2MB以下 / PNG JPG WEBP GIF
                  </span>
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-600">名前</label>
                  <input
                    value={nicknameDraft}
                    onChange={(e) =>
                      setNicknameDraft(e.target.value.replace(/[\n\r]/g, ""))
                    }
                    maxLength={20}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-600">
                    自己紹介
                  </label>
                  <textarea
                    value={bioDraft}
                    onChange={(e) => setBioDraft(e.target.value)}
                    maxLength={200}
                    rows={3}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-600">
                    趣味・関心
                  </label>
                  <input
                    value={interestsDraft}
                    onChange={(e) => setInterestsDraft(e.target.value)}
                    maxLength={120}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={profileSaving}
                    className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {profileSaving ? "保存中..." : "保存"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNicknameDraft(profileNickname ?? "");
                      setBioDraft(profileBio);
                      setInterestsDraft(profileInterests);
                      setProfileEditOpen(false);
                    }}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    キャンセル
                  </button>
                </div>
              </form>
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

