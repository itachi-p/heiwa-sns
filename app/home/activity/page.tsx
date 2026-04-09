"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
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
  } | null;
  users?: {
    nickname: string | null;
    avatar_url?: string | null;
    avatar_placeholder_hex?: string | null;
  } | null;
};

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

  const userId = user?.id ?? null;

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

  const fetchActivity = async (uid: string) => {
    setLoading(true);
    const { data: me, error: meErr } = await supabase
      .from("users")
      .select("nickname, avatar_url, avatar_placeholder_hex")
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
        "id, post_id, user_id, content, pending_content, created_at, moderation_max_score, posts!inner(id,user_id,content)"
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
      post: Array.isArray(r.posts) ? r.posts[0] ?? null : null,
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
  };

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
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

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setActivities([]);
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
        {userId && profileReady ? (
          <section>
            <nav className="mb-3 flex items-center gap-2 text-sm" aria-label="ホーム内タブ">
              <Link
                href="/home"
                className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50"
              >
                投稿
              </Link>
              <span className="rounded bg-blue-100 px-2 py-1 font-medium text-blue-700">
                アクティビティ
              </span>
            </nav>
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
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <UserAvatar
                          name={row.users?.nickname ?? null}
                          avatarUrl={row.users?.avatar_url ?? null}
                          placeholderHex={row.users?.avatar_placeholder_hex ?? null}
                        />
                        <span className="font-medium text-gray-800">
                          {row.users?.nickname ?? "（未設定）"}
                        </span>
                        <span>が返信</span>
                        <span>{row.created_at ? new Date(row.created_at).toLocaleString() : ""}</span>
                      </div>
                      <p className="mt-2 text-xs text-gray-500">対象投稿: {row.post?.content ?? ""}</p>
                      {folded ? (
                        <div className="mt-2 rounded-md border border-amber-100 bg-amber-50/60 px-3 py-2 text-sm">
                          <p className="text-gray-700">この返信は表示が制限されています</p>
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                next.add(row.id);
                                return next;
                              })
                            }
                            className="mt-1 text-left text-sm font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
                          >
                            タップして表示
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
    </main>
  );
}
