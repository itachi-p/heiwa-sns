"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { MustChangePasswordModal } from "@/components/must-change-password-modal";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";
import type { InterestPick } from "@/lib/interests";

const supabase = createClient();

type Post = {
  id: number;
  content: string;
  created_at?: string;
  user_id?: string;
  users?: {
    nickname: string | null;
    avatar_url?: string | null;
    avatar_placeholder_hex?: string | null;
  } | null;
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
  const [avatarPlaceholderHex, setAvatarPlaceholderHex] = useState<
    string | null
  >(null);
  const [bio, setBio] = useState("");
  const [interestPicks, setInterestPicks] = useState<InterestPick[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [inviteLabel, setInviteLabel] = useState<string | null>(null);

  const sessionId = sessionUser?.id ?? null;
  const isOwn = Boolean(sessionId && targetId === sessionId);
  /** UUID 形式でない URL は fetch せず、表示だけで判定（effect 内の同期 setState を避ける） */
  const idInvalid = targetId.length > 0 && !isLikelyUserId(targetId);

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
    if (!authReady || !sessionUser || idInvalid) return;

    let cancelled = false;

    void (async () => {
      setLoading(true);
      setErrorMessage(null);
      setNotFound(false);

      const { data: profile, error: profileErr } = await supabase
        .from("users")
        .select(
          "nickname, avatar_url, avatar_placeholder_hex, bio, must_change_password, invite_label"
        )
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

      const ownProfile = sessionUser?.id === targetId;
      const pRow = profile as {
        must_change_password?: boolean | null;
        invite_label?: string | null;
      };
      if (ownProfile) {
        setMustChangePassword(Boolean(pRow.must_change_password));
        setInviteLabel(
          typeof pRow.invite_label === "string" ? pRow.invite_label : null
        );
      } else {
        setMustChangePassword(false);
        setInviteLabel(null);
      }

      const nick = profile.nickname ?? null;
      const av = profile.avatar_url ?? null;
      const ph =
        (profile as { avatar_placeholder_hex?: string | null })
          .avatar_placeholder_hex ?? null;
      const merged: Post[] = (postRows ?? []).map((p) => ({
        ...p,
        users: {
          nickname: nick,
          avatar_url: av,
          avatar_placeholder_hex: ph,
        },
      }));

      setNickname(nick);
      setAvatarUrl(av);
      setAvatarPlaceholderHex(ph);
      setBio(profile.bio ?? "");
      setInterestPicks(picks);
      setPosts(merged);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, sessionUser, targetId, idInvalid]);

  const needsPasswordChange =
    Boolean(sessionId && targetId === sessionId && mustChangePassword);

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
        ) : notFound || idInvalid ? (
          <p className="text-sm text-gray-600">ユーザーが見つかりません。</p>
        ) : loading ? (
          <p className="text-gray-600">読み込み中…</p>
        ) : needsPasswordChange ? (
          <p className="text-sm text-gray-600">
            パスワードを変更するまでこの画面は利用できません。
          </p>
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
                <UserAvatar
                  name={nickname}
                  avatarUrl={avatarUrl}
                  placeholderHex={avatarPlaceholderHex}
                  size="lg"
                />
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

      <MustChangePasswordModal
        open={Boolean(
          sessionUser && targetId === sessionUser.id && needsPasswordChange
        )}
        userId={sessionUser?.id ?? null}
        inviteLabel={inviteLabel}
        onCompleted={() => {
          setMustChangePassword(false);
        }}
      />
    </main>
  );
}
