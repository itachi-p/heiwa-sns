"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { InterestPick } from "@/lib/interests";

const supabase = createClient();

type Post = {
  id: number;
  content: string;
  created_at?: string;
  user_id?: string;
  users?: { nickname: string | null; avatar_url?: string | null } | null;
};

function isLikelyUserId(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s.trim()
  );
}

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
  size = "lg",
}: {
  name: string | null | undefined;
  avatarUrl?: string | null;
  size?: "sm" | "lg";
}) {
  const sizeClass =
    size === "lg" ? "h-24 w-24 text-2xl" : "h-8 w-8 text-xs";
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

export default function UserHomePage() {
  const params = useParams();
  const rawId = typeof params.userId === "string" ? params.userId : "";
  const targetId = rawId.trim();

  const [authReady, setAuthReady] = useState(false);
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [nickname, setNickname] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [interestPicks, setInterestPicks] = useState<InterestPick[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);

  const sessionId = sessionUser?.id ?? null;
  const isOwn = Boolean(sessionId && targetId === sessionId);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionUser(session?.user ?? null);
      setAuthReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setSessionUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authReady || !sessionUser) return;
    if (!isLikelyUserId(targetId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    setNotFound(false);

    void (async () => {
      const { data: profile, error: profileErr } = await supabase
        .from("users")
        .select("nickname, avatar_url, bio")
        .eq("id", targetId)
        .maybeSingle();

      if (cancelled) return;
      if (profileErr) {
        setErrorMessage(profileErr.message);
        setLoading(false);
        return;
      }
      if (!profile) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const { data: uiRows, error: uiErr } = await supabase
        .from("user_interests")
        .select("position, tag_id, interest_tags ( label )")
        .eq("user_id", targetId)
        .order("position", { ascending: true });

      if (cancelled) return;
      if (uiErr) {
        setErrorMessage(uiErr.message);
        setLoading(false);
        return;
      }

      const picks: InterestPick[] = (uiRows ?? []).map((row) => {
        const rel = row.interest_tags as
          | { label: string }
          | { label: string }[]
          | null
          | undefined;
        const label = Array.isArray(rel) ? rel[0]?.label : rel?.label;
        return { id: String(row.tag_id), label: label ?? "" };
      }).filter((p) => p.label);

      const { data: postRows, error: postsErr } = await supabase
        .from("posts")
        .select("*")
        .eq("user_id", targetId)
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (postsErr) {
        setErrorMessage(postsErr.message);
        setLoading(false);
        return;
      }

      const nick = profile.nickname ?? null;
      const av = profile.avatar_url ?? null;
      const merged: Post[] = (postRows ?? []).map((p) => ({
        ...p,
        users: { nickname: nick, avatar_url: av },
      }));

      setNickname(nick);
      setAvatarUrl(av);
      setBio(profile.bio ?? "");
      setInterestPicks(picks);
      setPosts(merged);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, sessionUser, targetId]);

  return (
    <main className="min-h-screen bg-sky-50 text-gray-900">
      <div className="mx-auto max-w-xl p-6">
        <div className="mb-4 flex items-center gap-2 text-sm">
          <Link
            href="/"
            className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50"
          >
            タイムライン
          </Link>
          <Link
            href="/home"
            className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50"
          >
            マイホーム
          </Link>
        </div>

        {!authReady ? (
          <p className="text-gray-600">読み込み中…</p>
        ) : !sessionUser ? (
          <p className="text-sm text-gray-600">
            表示するには{" "}
            <Link href="/" className="text-blue-700 underline">
              タイムライン
            </Link>
            からログインしてください。
          </p>
        ) : loading ? (
          <p className="text-gray-600">読み込み中…</p>
        ) : notFound ? (
          <p className="text-sm text-gray-600">ユーザーが見つかりません。</p>
        ) : (
          <>
            {errorMessage ? (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {errorMessage}
              </div>
            ) : null}

            {isOwn ? (
              <p className="mb-3 text-xs text-gray-600">
                あなたのホームです。編集は{" "}
                <Link href="/home" className="text-blue-700 underline">
                  マイホーム
                </Link>
                から。
              </p>
            ) : null}

            <section className="mb-6 text-sm text-gray-700">
              <div className="flex min-w-0 items-start gap-3">
                <Avatar name={nickname} avatarUrl={avatarUrl} size="lg" />
                <div className="min-w-0 space-y-1">
                  <p className="text-lg font-semibold text-gray-800">
                    {nickname ?? "ニックネーム未設定"}
                  </p>
                  {bio ? (
                    <p className="whitespace-pre-wrap text-sm text-gray-700">
                      {bio}
                    </p>
                  ) : null}
                  {interestPicks.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                      <span className="shrink-0">趣味・関心:</span>
                      {interestPicks.map((p) => (
                        <span
                          key={p.id}
                          className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-900"
                        >
                          {p.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">
                このユーザーの投稿（新しい順）
              </h2>
              {posts.length === 0 ? (
                <p className="text-sm text-gray-500">まだ投稿がありません。</p>
              ) : (
                <ul className="space-y-3">
                  {posts.map((post) => (
                    <li
                      key={post.id}
                      className="break-words rounded-lg border border-gray-200 bg-white p-4"
                    >
                      <div className="mt-1 text-sm text-gray-500">
                        {post.created_at
                          ? new Date(post.created_at).toLocaleString()
                          : ""}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap break-words">
                        {renderTextWithLinks(post.content)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
