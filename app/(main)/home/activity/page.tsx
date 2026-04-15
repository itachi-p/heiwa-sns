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
  } | null;
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
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserIfChanged(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchActivity = async (uid: string) => {
    setLoading(true);
    const { data: me, error: meErr } = await supabase
      .from("users")
      .select(
        "nickname, avatar_url, avatar_placeholder_hex, must_change_password, invite_label"
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

    const { data, error } = await supabase
      .from("post_replies")
      .select(
        "id, post_id, user_id, content, pending_content, created_at, moderation_max_score, posts!inner(id,user_id,content,pending_content)"
      )
      .eq("posts.user_id", uid)
      .neq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as Array<
      ActivityRow & { posts?: { id: number; user_id: string; content: string }[] }
    >;
    const mapped: ActivityRow[] = rows.map((r) => ({
      ...r,
      post: normalizeJoinedPost(r),
    }));

    const authorIds = [
      ...new Set(mapped.map((r) => r.user_id).filter((id): id is string => Boolean(id))),
    ];
    const profileMap = new Map<
      string,
      { nickname: string | null; avatar_url?: string | null; avatar_placeholder_hex?: string | null }
    >();
    if (authorIds.length > 0) {
      const { data: profiles, error: pErr } = await supabase
        .from("users")
        .select("id, nickname, avatar_url, avatar_placeholder_hex")
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
        });
      }
    }
    setActivities(
      mapped.map((r) => ({
        ...r,
        users: profileMap.get(r.user_id) ?? null,
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
      startTransition(() => {
        setMustChangePassword(false);
        setInviteLabel(null);
      });
      return;
    }
    void (async () => {
      if (cancelled) return;
      setProfileReady(false);
      await fetchActivity(userId);
      if (cancelled) return;
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
                          <UserAvatar
                            name={row.users?.nickname ?? null}
                            avatarUrl={row.users?.avatar_url ?? null}
                            placeholderHex={row.users?.avatar_placeholder_hex ?? null}
                          />
                          <span className="font-medium text-gray-800">
                            {row.users?.nickname ?? "（未設定）"}
                          </span>
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
                        href={`/home?post=${row.post_id}`}
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
