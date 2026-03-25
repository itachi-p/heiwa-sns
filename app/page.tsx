"use client";

import React, {
  startTransition,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import type { PostgrestError, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { validateNickname } from "@/lib/nickname";

const supabase = createClient();

type Post = {
  id: number;
  content: string;
  created_at?: string;
  user_id?: string;
  /** 表示用（posts には保存せず users から解決） */
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

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  /** プロフィール取得済みか */
  const [profileReady, setProfileReady] = useState(false);
  /** null = 未設定 → ニックネーム入力が必要 */
  const [profileNickname, setProfileNickname] = useState<string | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [posts, setPosts] = useState<Post[]>([]);
  const [input, setInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [likedPostIds, setLikedPostIds] = useState<Set<number>>(
    () => new Set()
  );
  const [moderation, setModeration] = useState<{
    mode: "auto" | "mock" | "perspective";
    overallMax: number;
    truncated: boolean;
    paragraphs: Array<{
      index: number;
      text: string;
      maxScore: number;
      scores: Record<string, number>;
    }>;
  } | null>(null);
  const [moderationMode, setModerationMode] = useState<
    "auto" | "mock" | "perspective"
  >("auto");
  const [blockOnSubmit, setBlockOnSubmit] = useState(false);
  const [blockThreshold, setBlockThreshold] = useState(0.7);
  const [maxParagraphsToAnalyze, setMaxParagraphsToAnalyze] = useState(5);

  const userId = user?.id ?? null;

  const needsNickname =
    Boolean(userId) && profileReady && profileNickname === null;

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
    const { data: rows, error } = await supabase
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const list = (rows ?? []) as Post[];
    const authorIds = [
      ...new Set(
        list
          .map((p) => p.user_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    const nickByUserId = new Map<string, string | null>();
    if (authorIds.length > 0) {
      const { data: profiles, error: profileError } = await supabase
        .from("users")
        .select("id, nickname")
        .in("id", authorIds);

      if (profileError) {
        setErrorMessage(profileError.message);
        return;
      }
      for (const row of profiles ?? []) {
        nickByUserId.set(row.id, row.nickname);
      }
    }

    const merged: Post[] = list.map((p) => ({
      ...p,
      users: {
        nickname: p.user_id
          ? (nickByUserId.get(p.user_id) ?? null)
          : null,
      },
    }));

    setPosts(merged);
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

  /** ログイン後: users 行の確保 → nickname 取得 */
  useEffect(() => {
    if (!userId || !user) {
      startTransition(() => {
        setProfileReady(false);
        setProfileNickname(null);
        setNicknameDraft("");
      });
      return;
    }

    startTransition(() => {
      setProfileReady(false);
    });

    void (async () => {
      await ensurePublicUserRow(user);
      const { data, error } = await supabase
        .from("users")
        .select("nickname")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        setErrorMessage(error.message);
        setProfileReady(true);
        return;
      }

      const nick = data?.nickname ?? null;
      setProfileNickname(nick);
      setProfileReady(true);
    })();
  }, [userId, user]);

  /** nickname 確定後に投稿・いいね取得 */
  useEffect(() => {
    if (!userId || !profileReady || needsNickname) {
      if (!userId || !profileReady) {
        startTransition(() => {
          setPosts([]);
          setLikedPostIds(new Set());
        });
      }
      return;
    }

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
  }, [userId, profileReady, needsNickname]);

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

  const signInWithEmail = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setErrorMessage("メールアドレスとパスワードを入力してください。");
      return;
    }

    if (authMode === "signup") {
      const { error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
      });
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      setErrorMessage("確認メールを送信しました。メールを確認してください。");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
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
    setProfileNickname(null);
    setProfileReady(false);
    setNicknameDraft("");
  };

  const handleNicknameSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId) return;

    const result = validateNickname(nicknameDraft);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }

    setErrorMessage(null);
    const { error } = await supabase
      .from("users")
      .update({ nickname: result.value })
      .eq("id", userId);

    if (error) {
      const pgErr = error as PostgrestError;
      if (pgErr.code === "23505") {
        setErrorMessage("そのニックネームは既に使われています。");
        return;
      }
      setErrorMessage(error.message);
      return;
    }

    setProfileNickname(result.value);
    setNicknameDraft("");
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId) {
      setErrorMessage("ログインしてください。");
      return;
    }
    if (needsNickname) {
      setErrorMessage("先にニックネームを設定してください。");
      return;
    }
    const content = input.trim();
    if (!content) return;

    // Test-first: analyze on submit so you can observe score changes quickly.
    try {
      const res = await fetch("/api/moderate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: content,
          maxParagraphs: maxParagraphsToAnalyze,
          mode: moderationMode,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMessage(json?.error ?? "AI判定に失敗しました。");
        return;
      }
      setModeration(json);
      if (blockOnSubmit && typeof json?.overallMax === "number") {
        if (json.overallMax >= blockThreshold) {
          setErrorMessage(
            `AI判定スコアが高いため投稿を保留しました（max=${json.overallMax.toFixed(
              3
            )}）。`
          );
          return;
        }
      }
    } catch (err) {
      console.error("moderation error:", err);
      setErrorMessage("AI判定に失敗しました。");
      return;
    }

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

  const handleDeletePost = async (postId: number) => {
    if (!userId) {
      setErrorMessage("ログインしてください。");
      return;
    }

    const { error } = await supabase
      .from("posts")
      .delete()
      .eq("id", postId)
      .eq("user_id", userId);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setErrorMessage(null);
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    setLikedPostIds((prev) => {
      const next = new Set(prev);
      next.delete(postId);
      return next;
    });
  };

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-xl p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Nagi-SNS（仮名）</h1>
            <p className="mt-1 text-sm text-gray-600">
              「数」に追われる荒波から、穏やかな支流へ。
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {!authReady ? (
              <span className="text-gray-500">読み込み中…</span>
            ) : userId ? (
              <>
                <span
                  className="max-w-[200px] truncate text-gray-600"
                  title={profileNickname ?? ""}
                >
                  {profileNickname ?? "ニックネーム未設定"}
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
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void signInWithGoogle()}
                  className="rounded border border-gray-300 bg-white px-3 py-1 hover:bg-gray-50"
                >
                  Googleでログイン
                </button>
              </div>
            )}
          </div>
        </div>

        {errorMessage ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errorMessage}
          </div>
        ) : null}

        {!userId && authReady ? (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
            <p className="mb-3 text-sm text-gray-600">
              投稿・スキを利用するにはログインしてください。
            </p>
            <div className="mb-3 flex items-center gap-2 text-xs">
              <span className="text-gray-500">現在のモード:</span>
              <span
                className={[
                  "rounded-full px-2 py-1 font-medium",
                  authMode === "login"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-emerald-100 text-emerald-700",
                ].join(" ")}
              >
                {authMode === "login" ? "ログイン" : "新規登録"}
              </span>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAuthMode("login")}
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
                onClick={() => setAuthMode("signup")}
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
              <div className="flex gap-2">
                <button
                  type="submit"
                  className={[
                    "rounded-md px-3 py-2 text-sm font-medium text-white",
                    authMode === "login"
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "bg-emerald-600 hover:bg-emerald-700",
                  ].join(" ")}
                >
                  {authMode === "login" ? "メールでログイン" : "メールで新規登録"}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {userId && profileReady && needsNickname ? (
          <form
            onSubmit={handleNicknameSubmit}
            className="mb-6 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4"
          >
            <p className="text-sm text-gray-700">
              はじめにニックネームを設定してください（1〜20文字・改行不可）。
            </p>
            <input
              value={nicknameDraft}
              onChange={(e) =>
                setNicknameDraft(e.target.value.replace(/[\n\r]/g, ""))
              }
              maxLength={20}
              placeholder="ニックネーム"
              className="rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
              autoComplete="nickname"
            />
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700"
            >
              保存してはじめる
            </button>
          </form>
        ) : null}

        {userId && profileReady && !needsNickname ? (
          <>
            <form
              onSubmit={handleSubmit}
              className="mb-6 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4"
            >
              <details className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <summary className="cursor-pointer text-sm font-medium text-gray-800">
                  AI判定（テスト用）
                </summary>
                <div className="mt-3 grid gap-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2">
                      <span className="text-gray-600">モード</span>
                      <select
                        className="rounded border border-gray-300 bg-white px-2 py-1"
                        value={moderationMode}
                        onChange={(e) =>
                          setModerationMode(
                            e.target.value as "auto" | "mock" | "perspective"
                          )
                        }
                      >
                        <option value="auto">auto</option>
                        <option value="mock">mock（無料）</option>
                        <option value="perspective">perspective</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2">
                      <span className="text-gray-600">段落上限</span>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={maxParagraphsToAnalyze}
                        onChange={(e) =>
                          setMaxParagraphsToAnalyze(
                            Math.max(1, Math.min(20, Number(e.target.value)))
                          )
                        }
                        className="w-20 rounded border border-gray-300 bg-white px-2 py-1"
                      />
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
                  {moderation ? (
                    <div className="rounded-md border border-gray-200 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium text-gray-800">
                          判定結果（mode: {moderation.mode} / max:{" "}
                          {moderation.overallMax.toFixed(3)}）
                        </div>
                        {moderation.truncated ? (
                          <div className="text-xs text-gray-600">
                            解析対象を段落上限で切り詰めています
                          </div>
                        ) : null}
                      </div>
                      <ol className="mt-2 space-y-2 text-sm">
                        {moderation.paragraphs.map((p) => (
                          <li
                            key={p.index}
                            className="rounded border border-gray-200 p-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs text-gray-600">
                                段落 {p.index + 1}
                              </div>
                              <div className="text-xs font-medium text-gray-800">
                                max {p.maxScore.toFixed(3)}
                              </div>
                            </div>
                            <div className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm text-gray-800">
                              {p.text}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-700">
                              {Object.entries(p.scores).map(([k, v]) => (
                                <span
                                  key={k}
                                  className="rounded bg-gray-100 px-2 py-1"
                                >
                                  {k}: {Number(v).toFixed(3)}
                                </span>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </div>
              </details>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="いまどうしてる？"
                rows={4}
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
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-gray-800">
                      {post.users?.nickname ?? "（未設定）"}
                    </div>
                    {post.user_id === userId ? (
                      <button
                        type="button"
                        onClick={() => void handleDeletePost(post.id)}
                        className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                      >
                        削除
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm text-gray-500">
                    {post.created_at
                      ? new Date(post.created_at).toLocaleString()
                      : ""}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words">
                    {renderTextWithLinks(post.content)}
                  </div>
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
                          スキ
                        </button>
                      );
                    })()}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {userId && !profileReady ? (
          <p className="text-gray-600">プロフィールを読み込み中…</p>
        ) : null}
      </div>
    </main>
  );
}
