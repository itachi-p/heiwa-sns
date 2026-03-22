"use client";

import React, {
  startTransition,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

type Post = {
  id: number;
  content: string;
  created_at?: string;
  user_id?: string;
};

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [input, setInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [likedPostIds, setLikedPostIds] = useState<Set<number>>(
    () => new Set()
  );

  const userId = user?.id ?? null;

  /** トリガー失敗時の保険: 自分の行を upsert（RLS で auth.uid() = id のみ可） */
  async function ensurePublicUserRow(u: User) {
    const { error } = await supabase.from("users").upsert(
      {
        id: u.id,
        email: u.email ?? "",
      },
      { onConflict: "id" }
    );
    if (error) {
      console.warn("ensurePublicUserRow:", error.message);
    }
  }

  const fetchPosts = async () => {
    const { data, error } = await supabase.from("posts").select("*");

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    if (data) {
      setPosts(data as Post[]);
    }
    setErrorMessage(null);
  };

  const fetchLikes = async (uid: string) => {
    const { data, error } = await supabase
      .from("likes")
      .select("post_id")
      .eq("user_id", uid);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const next = new Set<number>();
    for (const row of data ?? []) {
      if (typeof row.post_id === "number") next.add(row.post_id);
      else if (row.post_id != null) next.add(Number(row.post_id));
    }
    setLikedPostIds(next);
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
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "auth") {
      startTransition(() => {
        setErrorMessage("ログインに失敗しました。もう一度お試しください。");
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!userId || !user) return;

    void ensurePublicUserRow(user);

    const run = async () => {
      try {
        await fetchPosts();
        await fetchLikes(userId);
      } catch (err) {
        console.error("fetch error:", err);
        setErrorMessage("データの取得に失敗しました。");
      }
    };

    void run();
  }, [userId, user]);

  const signInWithGoogle = async () => {
    setErrorMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setErrorMessage(error.message);
    }
  };

  const signOut = async () => {
    setErrorMessage(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setPosts([]);
    setLikedPostIds(new Set());
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId) {
      setErrorMessage("ログインしてください。");
      return;
    }
    const content = input.trim();
    if (!content) return;

    const { data, error } = await supabase
      .from("posts")
      .insert({ content, user_id: userId })
      .select()
      .single();

    if (error) {
      console.error("insert error:", error);
      setErrorMessage(error.message);
      return;
    }

    if (data) {
      setInput("");
      await fetchPosts();
    }
  };

  const handleLike = async (postId: number) => {
    if (!userId) {
      setErrorMessage("ログインしてください。");
      return;
    }

    const liked = likedPostIds.has(postId);

    if (liked) {
      const { error } = await supabase
        .from("likes")
        .delete()
        .eq("user_id", userId)
        .eq("post_id", postId);

      if (error) {
        console.error("unlike error:", error);
        setErrorMessage(error.message);
        return;
      }

      setErrorMessage(null);
      setLikedPostIds((prev) => {
        const next = new Set(prev);
        next.delete(postId);
        return next;
      });
      return;
    }

    const { error } = await supabase.from("likes").upsert(
      { user_id: userId, post_id: postId },
      { onConflict: "user_id,post_id" }
    );

    if (error) {
      console.error("like error:", error);
      setErrorMessage(error.message);
      return;
    }

    setErrorMessage(null);
    setLikedPostIds((prev) => {
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
  };

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-xl p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Simple SNS</h1>
          <div className="flex items-center gap-2 text-sm">
            {!authReady ? (
              <span className="text-gray-500">読み込み中…</span>
            ) : userId ? (
              <>
                <span className="max-w-[200px] truncate text-gray-600" title={user?.email ?? ""}>
                  {user?.email ?? userId.slice(0, 8) + "…"}
                </span>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="rounded border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50"
                >
                  ログアウト
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                className="rounded border border-gray-300 bg-white px-3 py-1 hover:bg-gray-50"
              >
                Googleでログイン
              </button>
            )}
          </div>
        </div>

        {errorMessage ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errorMessage}
          </div>
        ) : null}

        {!userId && authReady ? (
          <p className="text-gray-600">
            投稿・いいねを利用するには Google でログインしてください。
          </p>
        ) : null}

        {userId ? (
          <>
            <form
              onSubmit={handleSubmit}
              className="mb-6 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="いまどうしてる？"
                className="rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
              />
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700"
              >
                投稿
              </button>
            </form>

            <ul className="space-y-3">
              {posts.map((post) => (
                <li
                  key={post.id}
                  className="break-words rounded-lg border border-gray-200 bg-white p-4"
                >
                  <div className="text-sm text-gray-500">
                    {post.created_at
                      ? new Date(post.created_at).toLocaleString()
                      : ""}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap">{post.content}</div>
                  <div className="mt-3">
                    {(() => {
                      const liked = likedPostIds.has(post.id);
                      return (
                        <button
                          type="button"
                          onClick={() => void handleLike(post.id)}
                          className={[
                            "inline-flex items-center gap-2 rounded-md border px-3 py-1 text-sm font-medium transition-colors",
                            liked
                              ? "border-pink-300 bg-pink-50 text-pink-700"
                              : "border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
                          ].join(" ")}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className={liked ? "text-pink-600" : "text-gray-400"}
                            aria-hidden="true"
                          >
                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                          </svg>
                          いいね
                        </button>
                      );
                    })()}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </main>
  );
}
