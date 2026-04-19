"use client";

import Link from "next/link";
import React, {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { MustChangePasswordModal } from "@/components/must-change-password-modal";
import { SiteHeader } from "@/components/site-header";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";
import {
  fetchToxicityFilterLevel,
  fetchToxicityOverThresholdBehavior,
} from "@/lib/timeline-threshold";
import {
  DEFAULT_TOXICITY_OVER_THRESHOLD_BEHAVIOR,
  effectiveScoreForViewerToxicityFilter,
  thresholdForLevel,
  type ToxicityOverThresholdBehavior,
} from "@/lib/toxicity-filter-level";
import { formatRelativeTimeJa } from "@/lib/format-relative-time-ja";
import { previewPostSnippet } from "@/lib/post-content-preview";
import { VIEWER_TOXICITY_UPDATED_EVENT } from "@/components/viewer-toxicity-bus";

const supabase = createClient();

type ActivityRow = {
  id: number;
  post_id: number;
  user_id: string;
  content: string;
  pending_content?: string | null;
  created_at?: string;
  moderation_max_score?: number;
  post?: {
    id: number;
    user_id: string;
    content: string;
    pending_content?: string | null;
  } | null;
  users?: {
    nickname: string | null;
    avatar_url?: string | null;
    avatar_placeholder_hex?: string | null;
    public_id?: string | null;
  } | null;
  /**
   * ルート投稿のオーナー（= 元投稿の作者）の public_id。
   * 「リプ」画面のリンク先 `/@{owner}?post={postId}` を作るのに使う。
   * 自分のルート投稿に対する返信なら自分の public_id、
   * 他人のルート投稿に付けた自分の返信への返信なら相手の public_id。
   */
  postOwnerPublicId?: string | null;
};

function normalizeJoinedPost(
  row: ActivityRow & { posts?: unknown }
): ActivityRow["post"] {
  const p = row.posts;
  if (Array.isArray(p)) {
    const first = p[0] as
      | {
          id?: number;
          user_id?: string;
          content?: string;
          pending_content?: string | null;
        }
      | undefined;
    if (!first) return null;
    return {
      id: first.id as number,
      user_id: String(first.user_id ?? ""),
      content: String(first.content ?? ""),
      pending_content: first.pending_content ?? null,
    };
  }
  if (p && typeof p === "object" && p !== null && "id" in p) {
    const o = p as {
      id: number;
      user_id?: string;
      content?: string;
      pending_content?: string | null;
    };
    return {
      id: o.id,
      user_id: String(o.user_id ?? ""),
      content: String(o.content ?? ""),
      pending_content: o.pending_content ?? null,
    };
  }
  return null;
}

export default function HomeActivityPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [profileNickname, setProfileNickname] = useState<string | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profilePlaceholderHex, setProfilePlaceholderHex] = useState<
    string | null
  >(null);
  // 返信一覧から元投稿にスクロール遷移するための自分の public_id。
  // /@{publicId}?post=X で直接 HomePage に飛ばしてスクロールを効かせる。
  const [viewerPublicId, setViewerPublicId] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toxicityThreshold, setToxicityThreshold] = useState(0.7);
  const [overBehavior, setOverBehavior] = useState<ToxicityOverThresholdBehavior>(
    DEFAULT_TOXICITY_OVER_THRESHOLD_BEHAVIOR
  );
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [inviteLabel, setInviteLabel] = useState<string | null>(null);
  const loadedActivityUserIdRef = useRef<string | null>(null);

  const userId = user?.id ?? null;
  const needsPasswordChange =
    Boolean(userId) && profileReady && mustChangePassword;

  useEffect(() => {
    const setUserIfChanged = (next: User | null) => {
      setUser((prev) => {
        const prevId = prev?.id ?? null;
        const nextId = next?.id ?? null;
        if (prevId === nextId) return prev;
        return next;
      });
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserIfChanged(session?.user ?? null);
      setAuthReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setUserIfChanged(null);
        return;
      }
      if (!session?.user) return;
      setUserIfChanged(session.user);
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchActivity = async (uid: string) => {
    setLoading(true);
    const { data: me, error: meErr } = await supabase
      .from("users")
      .select(
        "nickname, avatar_url, avatar_placeholder_hex, public_id, must_change_password, invite_label"
      )
      .eq("id", uid)
      .maybeSingle();
    if (meErr) {
      setErrorMessage(meErr.message);
      setLoading(false);
      return;
    }
    setProfileNickname(me?.nickname ?? null);
    setProfileAvatarUrl(me?.avatar_url ?? null);
    setProfilePlaceholderHex(
      (me as { avatar_placeholder_hex?: string | null } | null)
        ?.avatar_placeholder_hex ?? null
    );
    const viewerPid = (me as { public_id?: string | null } | null)?.public_id;
    setViewerPublicId(
      typeof viewerPid === "string" && viewerPid.trim() ? viewerPid.trim() : null
    );
    const meRow = me as {
      must_change_password?: boolean | null;
      invite_label?: string | null;
    } | null;
    setMustChangePassword(Boolean(meRow?.must_change_password));
    setInviteLabel(
      typeof meRow?.invite_label === "string" ? meRow.invite_label : null
    );

    const [level, behavior] = await Promise.all([
      fetchToxicityFilterLevel(supabase, uid),
      fetchToxicityOverThresholdBehavior(supabase, uid),
    ]);
    setToxicityThreshold(thresholdForLevel(level));
    setOverBehavior(behavior);
    setExpanded(new Set());

    // 「リプ」画面の表示対象は「自分が直接の親となる返信」だけに限定する。
    // - A: ルート投稿（parent_reply_id IS NULL）で、その投稿主が自分
    // - B: 親が返信の場合、親返信の投稿者が自分
    // 旧仕様（自分のルート投稿配下の全返信を表示）から変更。
    // Supabase での自己参照 join が壊れやすいため、A と B を別クエリで取って結合する。
    const replySelect =
      "id, post_id, user_id, content, pending_content, created_at, moderation_max_score, posts!inner(id,user_id,content,pending_content)";

    const respA = await supabase
      .from("post_replies")
      .select(replySelect)
      .is("parent_reply_id", null)
      .eq("posts.user_id", uid)
      .neq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(100);
    if (respA.error) {
      setErrorMessage(respA.error.message);
      setLoading(false);
      return;
    }

    const myRepliesResp = await supabase
      .from("post_replies")
      .select("id")
      .eq("user_id", uid);
    if (myRepliesResp.error) {
      setErrorMessage(myRepliesResp.error.message);
      setLoading(false);
      return;
    }
    const myReplyIds = (myRepliesResp.data ?? [])
      .map((r) => Number((r as { id: number }).id))
      .filter((n) => Number.isFinite(n));

    let respBData: unknown[] = [];
    if (myReplyIds.length > 0) {
      const respB = await supabase
        .from("post_replies")
        .select(replySelect)
        .in("parent_reply_id", myReplyIds)
        .neq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(100);
      if (respB.error) {
        setErrorMessage(respB.error.message);
        setLoading(false);
        return;
      }
      respBData = respB.data ?? [];
    }

    type RawRow = ActivityRow & {
      posts?: { id: number; user_id: string; content: string }[];
    };
    const mergedById = new Map<number, RawRow>();
    for (const row of (respA.data ?? []) as RawRow[]) mergedById.set(row.id, row);
    for (const row of respBData as RawRow[]) mergedById.set(row.id, row);
    const merged = [...mergedById.values()]
      .sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      })
      .slice(0, 100);

    const mapped: ActivityRow[] = merged.map((r) => ({
      ...r,
      post: normalizeJoinedPost(r),
    }));

    // プロフィール取得対象は「返信した人」+「ルート投稿のオーナー」両方。
    // ルート投稿のオーナーは元投稿へのリンク先 (`/@{owner}?post=X`) を組み立てるのに必要。
    const authorIds = [
      ...new Set(
        [
          ...mapped.map((r) => r.user_id),
          ...mapped.map((r) => r.post?.user_id ?? null),
        ].filter((id): id is string => Boolean(id))
      ),
    ];
    const profileMap = new Map<
      string,
      {
        nickname: string | null;
        avatar_url?: string | null;
        avatar_placeholder_hex?: string | null;
        public_id?: string | null;
      }
    >();
    if (authorIds.length > 0) {
      const { data: profiles, error: pErr } = await supabase
        .from("users")
        .select("id, nickname, avatar_url, avatar_placeholder_hex, public_id")
        .in("id", authorIds);
      if (pErr) {
        setErrorMessage(pErr.message);
        setLoading(false);
        return;
      }
      for (const p of profiles ?? []) {
        profileMap.set(p.id, {
          nickname: p.nickname,
          avatar_url: p.avatar_url ?? null,
          avatar_placeholder_hex:
            (p as { avatar_placeholder_hex?: string | null }).avatar_placeholder_hex ??
            null,
          public_id:
            typeof (p as { public_id?: string | null }).public_id === "string"
              ? String((p as { public_id?: string | null }).public_id).trim() || null
              : null,
        });
      }
    }
    setActivities(
      mapped.map((r) => ({
        ...r,
        users: profileMap.get(r.user_id) ?? null,
        postOwnerPublicId:
          (r.post?.user_id && profileMap.get(r.post.user_id)?.public_id) || null,
      }))
    );
    setErrorMessage(null);
    setLoading(false);

    void supabase
      .from("users")
      .update({ activity_last_seen_at: new Date().toISOString() })
      .eq("id", uid);
  };

  const fetchActivityRef = useRef(fetchActivity);
  fetchActivityRef.current = fetchActivity;

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      loadedActivityUserIdRef.current = null;
      startTransition(() => {
        setMustChangePassword(false);
        setInviteLabel(null);
      });
      return;
    }
    if (loadedActivityUserIdRef.current === userId && profileReady) {
      return;
    }
    void (async () => {
      if (cancelled) return;
      setProfileReady(false);
      await fetchActivity(userId);
      if (cancelled) return;
      loadedActivityUserIdRef.current = userId;
      setProfileReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const h = () => {
      void fetchActivityRef.current(userId);
    };
    window.addEventListener(VIEWER_TOXICITY_UPDATED_EVENT, h);
    return () =>
      window.removeEventListener(VIEWER_TOXICITY_UPDATED_EVENT, h);
  }, [userId]);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setActivities([]);
    setMustChangePassword(false);
    setInviteLabel(null);
    setProfileReady(false);
  };

  const visibleActivities = useMemo(() => {
    if (overBehavior === "fold") return activities;
    return activities.filter((a) => {
      const score = effectiveScoreForViewerToxicityFilter(a.moderation_max_score);
      return score <= toxicityThreshold;
    });
  }, [activities, overBehavior, toxicityThreshold]);

  return (
    <main className="min-h-screen bg-sky-50 text-gray-900">
      <SiteHeader
        authReady={authReady}
        user={user}
        profileNickname={profileNickname}
        profileAvatarUrl={profileAvatarUrl}
        avatarPlaceholderHex={profilePlaceholderHex}
        onSignOut={signOut}
      />
      <div className="mx-auto max-w-xl p-4 sm:p-6">
        {!userId && authReady ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
            ログイン後にアクティビティが表示されます。
          </div>
        ) : null}
        {errorMessage?.trim() ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errorMessage}
          </div>
        ) : null}
        {userId && profileReady && !needsPasswordChange ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">新着アクティビティ</h2>
            {loading ? (
              <p className="text-sm text-gray-500">読み込み中…</p>
            ) : visibleActivities.length === 0 ? (
              <p className="text-sm text-gray-500">まだアクティビティはありません。</p>
            ) : (
              <ul className="space-y-3">
                {visibleActivities.map((row) => {
                  const score = effectiveScoreForViewerToxicityFilter(
                    row.moderation_max_score
                  );
                  const folded =
                    overBehavior === "fold" &&
                    score > toxicityThreshold &&
                    !expanded.has(row.id);
                  return (
                    <li
                      key={row.id}
                      className="rounded-lg border border-gray-200 bg-white p-4"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          {row.users?.public_id ? (
                            <Link
                              href={`/@${row.users.public_id}`}
                              className="inline-flex min-w-0 items-center gap-2 font-medium text-gray-800 hover:text-blue-800"
                            >
                              <UserAvatar
                                name={row.users?.nickname ?? null}
                                avatarUrl={row.users?.avatar_url ?? null}
                                placeholderHex={row.users?.avatar_placeholder_hex ?? null}
                              />
                              <span className="truncate">
                                {row.users?.nickname ?? `@${row.users.public_id}`}
                              </span>
                            </Link>
                          ) : (
                            <>
                              <UserAvatar
                                name={row.users?.nickname ?? null}
                                avatarUrl={row.users?.avatar_url ?? null}
                                placeholderHex={row.users?.avatar_placeholder_hex ?? null}
                              />
                              <span className="font-medium text-gray-800">
                                {row.users?.nickname ?? "（未設定）"}
                              </span>
                            </>
                          )}
                          <span className="shrink-0">が返信</span>
                        </div>
                        <time
                          className="shrink-0 text-gray-400"
                          dateTime={row.created_at ?? undefined}
                        >
                          {formatRelativeTimeJa(row.created_at)}
                        </time>
                      </div>
                      <Link
                        href={(() => {
                          // 元投稿のオーナー（自分 or 他人）のプロフィールに飛ばす。
                          // 自分のルート投稿への返信なら自分の /@{publicId}、
                          // 他人のルート投稿配下で自分の返信に付いた返信なら相手の /@{publicId}。
                          const ownerPid =
                            row.postOwnerPublicId || viewerPublicId;
                          return ownerPid
                            ? `/@${ownerPid}?post=${row.post_id}`
                            : "/";
                        })()}
                        className="mt-2 block rounded-md border border-gray-100 bg-gray-50/90 px-2.5 py-1.5 text-left transition-colors hover:border-gray-200 hover:bg-gray-100"
                      >
                        <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs font-normal leading-snug text-gray-600">
                          {previewPostSnippet(
                            row.post?.pending_content?.trim()
                              ? row.post.pending_content
                              : row.post?.content
                          ) || "（本文なし）"}
                        </p>
                      </Link>
                      {folded ? (
                        <div className="mt-2 rounded-md border border-amber-100 bg-amber-50/60 px-3 py-2 text-sm">
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                next.add(row.id);
                                return next;
                              })
                            }
                            className="w-full text-left text-sm font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
                          >
                            表示制限中（タップで展開）
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-800">
                          {row.pending_content?.trim() ? row.pending_content : row.content}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      <MustChangePasswordModal
        open={Boolean(userId && profileReady && needsPasswordChange)}
        userId={userId}
        inviteLabel={inviteLabel}
        onCompleted={() => {
          setMustChangePassword(false);
        }}
      />
    </main>
  );
}
