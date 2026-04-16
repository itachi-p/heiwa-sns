"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { SiteHeader } from "@/components/site-header";
import {
  ReplyComposerModal,
  ReplyBubbleIcon,
} from "@/components/reply-composer-modal";
import { ReplyThread, type PostReplyRow } from "@/components/reply-thread";
import { UserAvatar } from "@/components/user-avatar";
import { ModerationCompactRow } from "@/components/moderation-compact-row";
import { createClient } from "@/lib/supabase/client";
import type { InterestPick } from "@/lib/interests";
import { getPostImagePublicUrl } from "@/lib/post-image-storage";
import { partitionRepliesByParent } from "@/lib/reply-tree";
import { POST_AND_REPLY_MAX_CHARS } from "@/lib/compose-text-limits";
import { normalizePerspectiveScores } from "@/lib/perspective-labels";
import HomePage from "@/app/(main)/home/page";

const supabase = createClient();

type Post = {
  id: number;
  content: string;
  created_at?: string;
  user_id?: string;
  image_storage_path?: string | null;
  moderation_dev_scores?: { first?: Record<string, number>; second?: Record<string, number> } | null;
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
  const [viewerNickname, setViewerNickname] = useState<string | null>(null);
  const [viewerAvatarUrl, setViewerAvatarUrl] = useState<string | null>(null);
  const [viewerPlaceholderHex, setViewerPlaceholderHex] = useState<string | null>(
    null
  );
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
  const [likedPostIds, setLikedPostIds] = useState<Set<number>>(
    () => new Set()
  );
  const [openedReplyPosts, setOpenedReplyPosts] = useState<Set<number>>(
    () => new Set()
  );
  const [repliesByPost, setRepliesByPost] = useState<
    Record<number, PostReplyRow[]>
  >({});
  const [replyComposerPostId, setReplyComposerPostId] = useState<number | null>(
    null
  );
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [replySubmittingPostId, setReplySubmittingPostId] = useState<
    number | null
  >(null);
  const [replyScoresById, setReplyScoresById] = useState<
    Record<number, { first?: Record<string, number>; second?: Record<string, number> }>
  >({});

  const sessionId = sessionUser?.id ?? null;
  const isOwn = Boolean(sessionId && targetId && sessionId === targetId);
  const canInteract = Boolean(sessionId);

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
    if (!sessionUser?.id) {
      setViewerNickname(null);
      setViewerAvatarUrl(null);
      setViewerPlaceholderHex(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("users")
        .select("nickname, avatar_url, avatar_placeholder_hex")
        .eq("id", sessionUser.id)
        .maybeSingle();
      if (cancelled) return;
      setViewerNickname(data?.nickname ?? null);
      setViewerAvatarUrl(data?.avatar_url ?? null);
      setViewerPlaceholderHex(
        (data as { avatar_placeholder_hex?: string | null } | null)
          ?.avatar_placeholder_hex ?? null
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUser?.id]);

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

  useEffect(() => {
    if (!sessionId) {
      setLikedPostIds(new Set());
      return;
    }
    const postIds = posts.map((p) => p.id);
    if (postIds.length === 0) {
      setLikedPostIds(new Set());
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("likes")
        .select("post_id")
        .eq("user_id", sessionId)
        .in("post_id", postIds);
      if (cancelled) return;
      if (error) return;
      setLikedPostIds(new Set((data ?? []).map((r) => Number(r.post_id))));
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, posts]);

  const handleLike = async (postId: number) => {
    if (!sessionId) return;
    const liked = likedPostIds.has(postId);
    if (liked) {
      const { error } = await supabase
        .from("likes")
        .delete()
        .eq("user_id", sessionId)
        .eq("post_id", postId);
      if (error) return;
      setLikedPostIds((prev) => {
        const next = new Set(prev);
        next.delete(postId);
        return next;
      });
      return;
    }
    const { error } = await supabase.from("likes").upsert(
      { user_id: sessionId, post_id: postId },
      { onConflict: "user_id,post_id" }
    );
    if (error) return;
    setLikedPostIds((prev) => {
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
  };

  const fetchRepliesForPost = async (postId: number) => {
    const { data, error } = await supabase
      .from("post_replies")
      .select(
        "id, post_id, user_id, content, pending_content, created_at, parent_reply_id, moderation_max_score, moderation_dev_scores"
      )
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    if (error) return;
    const rows = (data ?? []) as PostReplyRow[];
    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
    let profileMap: Record<
      string,
      {
        nickname: string | null;
        avatar_url?: string | null;
        avatar_placeholder_hex?: string | null;
        public_id?: string | null;
      }
    > = {};
    if (userIds.length > 0) {
      const res = await fetch("/api/public-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userIds }),
      });
      const json = (await res.json()) as {
        profiles?: Array<{
          id: string;
          nickname: string | null;
          avatar_url?: string | null;
          avatar_placeholder_hex?: string | null;
          public_id?: string | null;
        }>;
      };
      profileMap = Object.fromEntries(
        (json.profiles ?? []).map((p) => [
          p.id,
          {
            nickname: p.nickname,
            avatar_url: p.avatar_url ?? null,
            avatar_placeholder_hex: p.avatar_placeholder_hex ?? null,
            public_id: p.public_id ?? null,
          },
        ])
      );
    }
    setRepliesByPost((prev) => ({
      ...prev,
      [postId]: rows.map((r) => ({
        ...r,
        users: profileMap[r.user_id] ?? null,
      })),
    }));
    setReplyScoresById((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const dev = (r as { moderation_dev_scores?: any }).moderation_dev_scores;
        if (dev?.first || dev?.second) {
          next[r.id] = { first: dev.first ?? undefined, second: dev.second ?? undefined };
        }
      }
      return next;
    });
  };

  const toggleReplyPanel = (postId: number) => {
    setOpenedReplyPosts((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
    if (!openedReplyPosts.has(postId) && repliesByPost[postId] == null) {
      void fetchRepliesForPost(postId);
    }
  };

  const handleReplySubmit = async (postId: number) => {
    if (!sessionId) return;
    const content = (replyDrafts[postId] ?? "").trim();
    if (!content) return;
    if (content.length > POST_AND_REPLY_MAX_CHARS) return;
    if (replySubmittingPostId != null) return;
    setReplySubmittingPostId(postId);
    try {
      const res = await fetch("/api/moderate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: content, mode: "perspective" }),
      });
      const json = (await res.json()) as {
        overallMax?: number;
        paragraphs?: Array<{ scores: Record<string, number> }>;
      };
      const scores = normalizePerspectiveScores(
        json.paragraphs?.[0]?.scores as Record<string, unknown> | undefined
      );
      const overallMax =
        typeof json.overallMax === "number" ? json.overallMax : 0;

      const { data: inserted, error } = await supabase
        .from("post_replies")
        .insert({
          post_id: postId,
          user_id: sessionId,
          content,
          moderation_max_score: overallMax,
          moderation_dev_scores:
            Object.keys(scores).length > 0 ? { first: scores } : null,
        })
        .select("id")
        .single();
      if (error) return;
      if (inserted?.id && Object.keys(scores).length > 0) {
        setReplyScoresById((prev) => ({
          ...prev,
          [inserted.id]: { first: scores },
        }));
      }
      setReplyDrafts((prev) => ({ ...prev, [postId]: "" }));
      setReplyComposerPostId(null);
      await fetchRepliesForPost(postId);
    } finally {
      setReplySubmittingPostId(null);
    }
  };

  return (
    isOwn ? (
      <HomePage />
    ) : (
    <main className="min-h-screen bg-sky-50 text-gray-900">
      <SiteHeader
        authReady={authReady}
        user={sessionUser}
        profileNickname={viewerNickname}
        profileAvatarUrl={viewerAvatarUrl}
        avatarPlaceholderHex={viewerPlaceholderHex}
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
                    const liked = likedPostIds.has(post.id);
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
                        {post.moderation_dev_scores?.first ||
                        post.moderation_dev_scores?.second ? (
                          <div className="mt-2 space-y-1 rounded border border-gray-100 bg-gray-50/80 px-2 py-1">
                            {post.moderation_dev_scores?.first ? (
                              <ModerationCompactRow
                                scores={post.moderation_dev_scores.first}
                              />
                            ) : null}
                            {post.moderation_dev_scores?.second ? (
                              <ModerationCompactRow
                                scores={post.moderation_dev_scores.second}
                              />
                            ) : null}
                          </div>
                        ) : null}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {canInteract ? (
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
                                className={
                                  liked ? "text-pink-600" : "text-gray-400"
                                }
                                aria-hidden="true"
                              >
                                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                              </svg>
                              スキ
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              const opened = openedReplyPosts.has(post.id);
                              if (opened && canInteract) {
                                setReplyComposerPostId(post.id);
                                return;
                              }
                              toggleReplyPanel(post.id);
                            }}
                            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50"
                            aria-label="返信"
                            title="返信"
                          >
                            <ReplyBubbleIcon />
                          </button>
                        </div>
                        {openedReplyPosts.has(post.id) ? (
                          <div className="mt-3 border-t border-gray-100 pt-3 text-sm">
                            {(() => {
                              const flat = repliesByPost[post.id] ?? [];
                              if (flat.length === 0) {
                                return (
                                  <p className="text-xs text-gray-500">
                                    返信はまだありません。
                                  </p>
                                );
                              }
                              const { roots, childrenByParent } =
                                partitionRepliesByParent(flat);
                              return (
                                <ReplyThread
                                  roots={roots}
                                  childrenByParent={childrenByParent}
                                  userId={sessionId}
                                  canInteract={canInteract}
                                  nowTick={Date.now()}
                                  editingReplyId={null}
                                  editReplyDraft=""
                                  replyEditSaving={false}
                                  replyVisibilityThreshold={1}
                                  overThresholdBehavior="hide"
                                  replyScoresById={replyScoresById}
                                  onEditDraftChange={() => {}}
                                  onStartEdit={() => {}}
                                  onCancelEdit={() => {}}
                                  onSaveEdit={() => {}}
                                  onDelete={() => {}}
                                />
                              );
                            })()}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
      {canInteract && replyComposerPostId != null ? (
        <ReplyComposerModal
          open
          onClose={() => {
            if (replySubmittingPostId != null) return;
            setReplyComposerPostId(null);
          }}
          onSubmit={() => void handleReplySubmit(replyComposerPostId)}
          submitting={replySubmittingPostId === replyComposerPostId}
          draft={replyDrafts[replyComposerPostId] ?? ""}
          onDraftChange={(v) =>
            setReplyDrafts((prev) => ({ ...prev, [replyComposerPostId]: v }))
          }
          targetNickname={nickname}
          targetAvatarUrl={avatarUrl}
          targetPlaceholderHex={avatarPlaceholderHex}
          targetPreview={
            posts.find((p) => p.id === replyComposerPostId)?.content ?? ""
          }
          viewerNickname={viewerNickname}
          viewerAvatarUrl={viewerAvatarUrl}
          viewerPlaceholderHex={viewerPlaceholderHex}
        />
      ) : null}
    </main>
    )
  );
}
