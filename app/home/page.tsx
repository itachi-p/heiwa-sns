"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

type Post = {
  id: number;
  content: string;
  created_at?: string;
  user_id?: string;
  users?: { nickname: string | null } | null;
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

function Avatar({ name }: { name: string | null | undefined }) {
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
  const [posts, setPosts] = useState<Post[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      .select("nickname")
      .eq("id", uid)
      .maybeSingle();

    if (profileError) {
      setErrorMessage(profileError.message);
      return;
    }

    const nickname = profile?.nickname ?? null;
    const merged = ((rows ?? []) as Post[]).map((p) => ({
      ...p,
      users: { nickname },
    }));

    setPosts(merged);
    setProfileNickname(nickname);
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

  return (
    <main className="min-h-screen bg-sky-50 text-gray-900">
      <div className="mx-auto max-w-xl p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Nagi-SNS（仮名）</h1>
            <p className="mt-1 text-sm text-gray-600">ホーム</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {!authReady ? (
              <span className="text-gray-500">読み込み中…</span>
            ) : userId ? (
              <>
                <span className="flex items-center gap-2">
                  <Avatar name={profileNickname} />
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
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              あなたの投稿（新しい順）
            </h2>
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
                        <Avatar name={post.users?.nickname ?? null} />
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
          </section>
        ) : null}
      </div>
    </main>
  );
}

