"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { SiteHeader } from "@/components/site-header";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";
import type { InterestPick } from "@/lib/interests";
import { getPostImagePublicUrl } from "@/lib/post-image-storage";

const supabase = createClient();

type Post = {
  id: number;
  content: string;
  created_at?: string;
  user_id?: string;
  image_storage_path?: string | null;
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

export default function PublicProfilePage() {
  const params = useParams();
  const raw = typeof params?.handle === "string" ? params.handle : "";
  const handle = raw.trim().toLowerCase();

  const [authReady, setAuthReady] = useState(false);
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [targetId, setTargetId] = useState<string | null>(null);
  const [nickname, setNickname] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarPlaceholderHex, setAvatarPlaceholderHex] = useState<
    string | null
  >(null);
  const [bio, setBio] = useState("");
  const [interestPicks, setInterestPicks] = useState<InterestPick[]>([]);
  const [externalUrl, setExternalUrl] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);

  const sessionId = sessionUser?.id ?? null;

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
    if (!handle) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoading(true);
      setErrorMessage(null);
      setNotFound(false);

      const { data: profile, error: profileErr } = await supabase
        .from("users")
        .select(
          "id, nickname, avatar_url, avatar_placeholder_hex, bio, profile_external_url, public_id"
        )
        .eq("public_id", handle)
        .maybeSingle();

      if (cancelled) return;
      if (profileErr) {
        setErrorMessage(profileErr.message);
        setLoading(false);
        return;
      }
      if (!profile?.id) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const uid = profile.id as string;
      setTargetId(uid);
      setNickname(profile.nickname ?? null);
      setAvatarUrl(profile.avatar_url ?? null);
      setAvatarPlaceholderHex(
        (profile as { avatar_placeholder_hex?: string | null })
          .avatar_placeholder_hex ?? null
      );
      setBio(profile.bio ?? "");
      setExternalUrl(
        typeof (profile as { profile_external_url?: string | null })
          .profile_external_url === "string"
          ? String(
              (profile as { profile_external_url?: string | null })
                .profile_external_url
            ).trim()
          : ""
      );

      const { data: uiRows, error: uiErr } = await supabase
        .from("user_interests")
        .select("position, tag_id, interest_tags ( label )")
        .eq("user_id", uid)
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
      setInterestPicks(picks);

      const { data: postRows, error: postsErr } = await supabase
        .from("posts")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (postsErr) {
        setErrorMessage(postsErr.message);
        setLoading(false);
        return;
      }

      setPosts((postRows ?? []) as Post[]);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [handle]);

  return (
    <main className="min-h-screen bg-sky-50 text-gray-900">
      <SiteHeader
        authReady={authReady}
        user={sessionUser}
        profileNickname={
          sessionId === targetId ? nickname : sessionUser?.email ?? null
        }
        profileAvatarUrl={sessionId === targetId ? avatarUrl : null}
        avatarPlaceholderHex={
          sessionId === targetId ? avatarPlaceholderHex : null
        }
        onSignOut={async () => {
          await supabase.auth.signOut();
        }}
      />

      <div className="mx-auto max-w-xl p-4 sm:p-6">
        {!authReady ? (
          <p className="text-gray-600">読み込み中…</p>
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

            <section className="mb-6 text-sm text-gray-700">
              <div className="flex min-w-0 items-start gap-3">
                <UserAvatar
                  name={nickname}
                  avatarUrl={avatarUrl}
                  placeholderHex={avatarPlaceholderHex}
                  size="lg"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-mono text-xs text-gray-500">@{handle}</p>
                  <p className="truncate text-lg font-semibold text-gray-800">
                    {nickname ?? `@${handle}`}
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
                  {externalUrl.trim() ? (
                    <p className="pt-0.5 text-sm">
                      <a
                        href={externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all font-medium text-sky-800 hover:text-sky-950 hover:underline"
                      >
                        {externalUrl}
                      </a>
                    </p>
                  ) : null}
                </div>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-gray-800">
                投稿
              </h2>
              {posts.length === 0 ? (
                <p className="text-sm text-gray-500">まだ投稿がありません。</p>
              ) : (
                <ul className="space-y-3">
                  {posts.map((post) => {
                    const img = getPostImagePublicUrl(
                      supabase,
                      post.image_storage_path
                    );
                    return (
                      <li
                        key={post.id}
                        className="break-words rounded-lg border border-gray-200 bg-white p-4"
                      >
                        <div className="mb-2 flex min-w-0 items-center gap-2 text-sm font-medium text-gray-800">
                          <UserAvatar
                            name={nickname}
                            avatarUrl={avatarUrl}
                            placeholderHex={avatarPlaceholderHex}
                          />
                          <span className="truncate">
                            {nickname ?? `@${handle}`}
                          </span>
                        </div>
                        <div className="mb-1 text-xs text-gray-500">
                          {post.created_at
                            ? new Date(post.created_at).toLocaleString()
                            : ""}
                        </div>
                        {img ? (
                          <div className="mb-2 overflow-hidden rounded-md border border-gray-100 bg-gray-50">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img}
                              alt=""
                              className="max-h-96 w-full object-contain"
                              loading="lazy"
                            />
                          </div>
                        ) : null}
                        <div className="whitespace-pre-wrap break-words text-sm">
                          {renderTextWithLinks(post.content)}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
