"use client";

import React, {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import type { PostgrestError, User } from "@supabase/supabase-js";
import { NicknameRequiredModal } from "@/components/nickname-required-modal";
import { ReplyThread } from "@/components/reply-thread";
import { SiteHeader } from "@/components/site-header";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";
import { pickAvatarPlaceholderHex } from "@/lib/avatar-placeholder";
import { ModerationCompactRow } from "@/components/moderation-compact-row";
import { normalizePerspectiveScores } from "@/lib/perspective-labels";
import {
  ANON_TOXICITY_VIEW_THRESHOLD,
  fetchToxicityFilterLevel,
} from "@/lib/timeline-threshold";
import {
  POST_HIGH_TOXICITY_VISIBILITY_NOTICE,
  REPLY_HIGH_TOXICITY_VISIBILITY_NOTICE,
} from "@/lib/visibility-notice";
import {
  DEFAULT_TOXICITY_FILTER_LEVEL,
  effectiveScoreForViewerToxicityFilter,
  HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD,
  thresholdForLevel,
  type ToxicityFilterLevel,
} from "@/lib/toxicity-filter-level";
import { isMissingAvatarPlaceholderHexError } from "@/lib/users-update-fallback";
import { validateNickname } from "@/lib/nickname";
import {
  canEditOwnPost,
  formatRemainingLabel,
  getEditRemainingMs,
  resolvePendingVisibleContent,
} from "@/lib/post-edit-window";
import { partitionRepliesByParent } from "@/lib/reply-tree";
import { sortTimelinePosts } from "@/lib/timeline-sort";
import {
  getPostImagePublicUrl,
  preparePostImageForUpload,
  removePostImageIfAny,
  type PreparedPostImage,
  uploadPostImage,
} from "@/lib/post-image-storage";
import {
  POST_DEV_SCORES_KEY,
  REPLY_DEV_SCORES_KEY,
  hydrateDevScoresFromIdb,
  loadDevScoresFromLocalStorage,
  mergeDevScoresById,
  parseRawToDevScores,
  persistDevScoresToLocalStorage,
} from "@/lib/dev-scores-local-storage";
import { buildDevScoresByIdFromRows } from "@/lib/moderation-dev-scores-db";
import { persistModerationDevScores } from "@/lib/persist-moderation-dev-scores-client";
import {
  idbLoadPostDevScores,
  idbLoadReplyDevScores,
  idbSavePostDevScores,
  idbSaveReplyDevScores,
} from "@/lib/moderation-scores-indexeddb";
import { isPastInitialEditWindow } from "@/lib/second-moderation-timing";
import {
  fetchPerspectiveScoresForText,
  loadPostIdsPendingSecondModeration,
  loadReplyIdsPendingSecondModeration,
  markPostNeedsSecondModeration,
  markReplyNeedsSecondModeration,
  removePostNeedsSecondModeration,
  removeReplyNeedsSecondModeration,
} from "@/lib/pending-second-moderation";

const supabase = createClient();

type Post = {
  id: number;
  content: string;
  pending_content?: string | null;
  created_at?: string;
  user_id?: string;
  moderation_max_score?: number;
  /** 開発用5指標（DB）。閲覧フィルタは moderation_max_score のみ */
  moderation_dev_scores?: unknown;
  image_storage_path?: string | null;
  /** 表示用（posts には保存せず users から解決） */
  users?: {
    nickname: string | null;
    avatar_url?: string | null;
    avatar_placeholder_hex?: string | null;
  } | null;
};

const RELATION_PENALTY_MIN_SCORE = 0.2;
const RELATION_PENALTY_WINDOW_DAYS = 14;

type PostReply = {
  id: number;
  post_id: number;
  user_id: string;
  content: string;
  pending_content?: string | null;
  created_at?: string;
  parent_reply_id?: number | null;
  moderation_max_score?: number;
  moderation_dev_scores?: unknown;
  users?: {
    nickname: string | null;
    avatar_url?: string | null;
    avatar_placeholder_hex?: string | null;
  } | null;
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
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profilePlaceholderHex, setProfilePlaceholderHex] = useState<
    string | null
  >(null);
  /** users.toxicity_filter_level（タイムライン・リプの閾値は TOXICITY_THRESHOLDS で導出） */
  const [toxicityFilterLevel, setToxicityFilterLevel] =
    useState<ToxicityFilterLevel>(DEFAULT_TOXICITY_FILTER_LEVEL);
  /** 5指標テスト表示（画面用のみ・localStorage。初期化で読み込まないと空 {} が先に保存され消える） */
  const [postScoresById, setPostScoresById] = useState(() =>
    loadDevScoresFromLocalStorage(POST_DEV_SCORES_KEY)
  );
  const [replyScoresById, setReplyScoresById] = useState(() =>
    loadDevScoresFromLocalStorage(REPLY_DEV_SCORES_KEY)
  );
  /** IDB 復元前に空状態を IDB へ書かない（表示が一瞬消える原因の一つ） */
  const [scoresPersistenceEnabled, setScoresPersistenceEnabled] =
    useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [input, setInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** 数秒で消える通知（編集保存・注意など） */
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [likedPostIds, setLikedPostIds] = useState<Set<number>>(
    () => new Set()
  );
  const [moderationMode, setModerationMode] = useState<
    "mock" | "perspective"
  >("perspective");
  const [moderationDegradedMessage, setModerationDegradedMessage] = useState<
    string | null
  >(null);
  const [repliesByPost, setRepliesByPost] = useState<
    Record<number, PostReply[]>
  >({});
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [replySubmittingPostId, setReplySubmittingPostId] = useState<
    number | null
  >(null);
  /** 返信入力を開いている投稿（タップで開閉） */
  const [replyComposerPostId, setReplyComposerPostId] = useState<number | null>(
    null
  );
  const [blockOnSubmit, setBlockOnSubmit] = useState(false);
  const [blockThreshold, setBlockThreshold] = useState(0.7);
  const [composeOpen, setComposeOpen] = useState(false);
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [composePostImage, setComposePostImage] =
    useState<PreparedPostImage | null>(null);
  const [composeImagePreviewUrl, setComposeImagePreviewUrl] = useState<
    string | null
  >(null);
  const [authGateModal, setAuthGateModal] = useState<{
    open: boolean;
    message: string;
  }>({ open: false, message: "" });
  const [nicknameModalError, setNicknameModalError] = useState<string | null>(
    null
  );
  const [editingPostId, setEditingPostId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [postEditSaving, setPostEditSaving] = useState(false);
  const [replyParentReplyId, setReplyParentReplyId] = useState<number | null>(
    null
  );
  const [editingReplyId, setEditingReplyId] = useState<number | null>(null);
  const [editReplyDraft, setEditReplyDraft] = useState("");
  const [replyEditSaving, setReplyEditSaving] = useState(false);
  const postScoresByIdRef = useRef(postScoresById);
  const replyScoresByIdRef = useRef(replyScoresById);
  const secondModerationBusyRef = useRef<Set<string>>(new Set());
  postScoresByIdRef.current = postScoresById;
  replyScoresByIdRef.current = replyScoresById;
  const userId = user?.id ?? null;

  const needsNickname =
    Boolean(userId) && profileReady && profileNickname === null;

  useEffect(() => {
    if (!needsNickname) setNicknameModalError(null);
  }, [needsNickname]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 4000);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  useEffect(() => {
    if (!composePostImage) {
      setComposeImagePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(composePostImage.blob);
    setComposeImagePreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [composePostImage]);

  useEffect(() => {
    if (!scoresPersistenceEnabled) return;
    persistDevScoresToLocalStorage(POST_DEV_SCORES_KEY, postScoresById);
    void idbSavePostDevScores(postScoresById);
  }, [postScoresById, scoresPersistenceEnabled]);

  useEffect(() => {
    if (!scoresPersistenceEnabled) return;
    persistDevScoresToLocalStorage(REPLY_DEV_SCORES_KEY, replyScoresById);
    void idbSaveReplyDevScores(replyScoresById);
  }, [replyScoresById, scoresPersistenceEnabled]);

  /** IndexedDB をマージ（localStorage 初期値より欠損しにくい） */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [fromPosts, fromReplies] = await Promise.all([
        idbLoadPostDevScores(),
        idbLoadReplyDevScores(),
      ]);
      if (cancelled) return;
      setPostScoresById((p) => hydrateDevScoresFromIdb(p, fromPosts));
      setReplyScoresById((p) => hydrateDevScoresFromIdb(p, fromReplies));
      setScoresPersistenceEnabled(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 別タブ・別ウィンドウで保存したスコアをマージ（同一ブラウザ・ユーザー切替と無関係） */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === POST_DEV_SCORES_KEY && e.newValue) {
        const incoming = parseRawToDevScores(e.newValue);
        setPostScoresById((prev) => mergeDevScoresById(prev, incoming));
      }
      if (e.key === REPLY_DEV_SCORES_KEY && e.newValue) {
        const incoming = parseRawToDevScores(e.newValue);
        setReplyScoresById((prev) => mergeDevScoresById(prev, incoming));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (editingPostId != null) {
      const post = posts.find((p) => p.id === editingPostId);
      if (post && getEditRemainingMs(post.created_at, nowTick) <= 0) {
        setEditingPostId(null);
        setToastMessage(
          "編集時間が終了しました。保存済みの内容は投稿から15分後に反映されます。"
        );
      }
    }
    if (editingReplyId != null) {
      const allReplies = Object.values(repliesByPost).flat();
      const reply = allReplies.find((r) => r.id === editingReplyId);
      if (reply && getEditRemainingMs(reply.created_at, nowTick) <= 0) {
        setEditingReplyId(null);
        setToastMessage(
          "編集時間が終了しました。保存済みの内容は投稿から15分後に反映されます。"
        );
      }
    }
  }, [nowTick, editingPostId, editingReplyId, posts, repliesByPost]);

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
    if (userId) {
      try {
        await fetch("/api/finalize-my-pending", {
          method: "POST",
          credentials: "same-origin",
        });
      } catch {
        /* 確定 API が失敗しても一覧取得は続行 */
      }
    }
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

    const profileByUserId = new Map<
      string,
      {
        nickname: string | null;
        avatar_url: string | null;
        avatar_placeholder_hex: string | null;
      }
    >();
    if (authorIds.length > 0) {
      const { data: profiles, error: profileError } = await supabase
        .from("users")
        .select("id, nickname, avatar_url, avatar_placeholder_hex")
        .in("id", authorIds);

      if (profileError) {
        setErrorMessage(profileError.message);
        return;
      }
      for (const row of profiles ?? []) {
        profileByUserId.set(row.id, {
          nickname: row.nickname,
          avatar_url: row.avatar_url ?? null,
          avatar_placeholder_hex:
            (row as { avatar_placeholder_hex?: string | null })
              .avatar_placeholder_hex ?? null,
        });
      }
    }

    const merged: Post[] = list.map((p) => ({
      ...p,
      users: {
        nickname: p.user_id
          ? (profileByUserId.get(p.user_id)?.nickname ?? null)
          : null,
        avatar_url: p.user_id
          ? (profileByUserId.get(p.user_id)?.avatar_url ?? null)
          : null,
        avatar_placeholder_hex: p.user_id
          ? (profileByUserId.get(p.user_id)?.avatar_placeholder_hex ?? null)
          : null,
      },
    }));

    const relationMultiplierByAuthor = new Map<string, number>();
    if (userId) {
      const since = new Date(
        Date.now() - RELATION_PENALTY_WINDOW_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      const { data: evRows, error: evErr } = await supabase
        .from("reply_toxic_events")
        .select("actor_user_id, max_score")
        .eq("target_user_id", userId)
        .gte("created_at", since);
      if (!evErr) {
        for (const row of evRows ?? []) {
          const actor = row.actor_user_id as string;
          const m = Math.max(0.5, Math.min(0.8, 1 - Number(row.max_score ?? 0)));
          relationMultiplierByAuthor.set(
            actor,
            Math.min(relationMultiplierByAuthor.get(actor) ?? 1, m)
          );
        }
      }
    }

    const affinityLikeScoreByAuthor = new Map<string, number>();
    if (userId) {
      const { data: affRows, error: affErr } = await supabase
        .from("user_affinity")
        .select("to_user_id, like_score")
        .eq("from_user_id", userId);
      if (!affErr) {
        for (const row of affRows ?? []) {
          const toId = row.to_user_id as string;
          affinityLikeScoreByAuthor.set(
            toId,
            typeof row.like_score === "number" ? row.like_score : 0
          );
        }
      }
    }

    const viewThreshold = userId
      ? thresholdForLevel(toxicityFilterLevel)
      : ANON_TOXICITY_VIEW_THRESHOLD;

    const timelinePosts = sortTimelinePosts(
      merged.filter((p) => {
        const score = effectiveScoreForViewerToxicityFilter(
          p.moderation_max_score
        );
        if (userId && p.user_id === userId) return true;
        return score <= viewThreshold;
      }),
      userId,
      affinityLikeScoreByAuthor,
      relationMultiplierByAuthor
    );

    setPosts(timelinePosts);

    const postIds = timelinePosts.map((p) => p.id);
    let replyRowsFlat: PostReply[] = [];
    if (postIds.length === 0) {
      setRepliesByPost({});
    } else {
      const { data: replyRows, error: replyErr } = await supabase
        .from("post_replies")
        .select("*")
        .in("post_id", postIds)
        .order("created_at", { ascending: true });

      if (replyErr) {
        setErrorMessage(replyErr.message);
        return;
      }

      const rlist = (replyRows ?? []) as Array<{
        id: number;
        post_id: number;
        user_id: string;
        content: string;
        pending_content?: string | null;
        created_at?: string;
        parent_reply_id?: number | null;
      }>;
      const replyAuthorIds = [
        ...new Set(rlist.map((r) => r.user_id).filter(Boolean)),
      ];
      const replyProfileByUserId = new Map<
        string,
        {
          nickname: string | null;
          avatar_url: string | null;
          avatar_placeholder_hex: string | null;
        }
      >();
      if (replyAuthorIds.length > 0) {
        const { data: rprofiles, error: rpe } = await supabase
          .from("users")
          .select("id, nickname, avatar_url, avatar_placeholder_hex")
          .in("id", replyAuthorIds);
        if (rpe) {
          setErrorMessage(rpe.message);
          return;
        }
        for (const row of rprofiles ?? []) {
          replyProfileByUserId.set(row.id, {
            nickname: row.nickname,
            avatar_url: row.avatar_url ?? null,
            avatar_placeholder_hex:
              (row as { avatar_placeholder_hex?: string | null })
                .avatar_placeholder_hex ?? null,
          });
        }
      }

      const byPost: Record<number, PostReply[]> = {};
      for (const r of rlist) {
        const arr = byPost[r.post_id] ?? [];
        const rp = replyProfileByUserId.get(r.user_id);
        arr.push({
          ...r,
          users: {
            nickname: rp?.nickname ?? null,
            avatar_url: rp?.avatar_url ?? null,
            avatar_placeholder_hex: rp?.avatar_placeholder_hex ?? null,
          },
        });
        byPost[r.post_id] = arr;
      }
      setRepliesByPost(byPost);
      replyRowsFlat = Object.values(byPost).flat();
    }

    const postScoresFromDb = buildDevScoresByIdFromRows(timelinePosts);
    const replyScoresFromDb = buildDevScoresByIdFromRows(replyRowsFlat);
    setPostScoresById((prev) => mergeDevScoresById(prev, postScoresFromDb));
    setReplyScoresById((prev) => mergeDevScoresById(prev, replyScoresFromDb));
    for (const pid of loadPostIdsPendingSecondModeration()) {
      if (postScoresFromDb[pid]?.second) removePostNeedsSecondModeration(pid);
    }
    for (const rid of loadReplyIdsPendingSecondModeration()) {
      if (replyScoresFromDb[rid]?.second) removeReplyNeedsSecondModeration(rid);
    }

    setErrorMessage(null);
  };

  const fetchPostsRef = useRef(fetchPosts);
  fetchPostsRef.current = fetchPosts;

  const hasPendingContent = useMemo(
    () =>
      posts.some((p) => Boolean(p.pending_content?.trim())) ||
      Object.values(repliesByPost)
        .flat()
        .some((r) => Boolean(r.pending_content?.trim())),
    [posts, repliesByPost]
  );

  /** pending 中に加え、2行目未取得の post/reply id が localStorage に残っている間もポーリング */
  const shouldPollTimeline = useMemo(() => {
    if (hasPendingContent) return true;
    if (typeof window === "undefined") return false;
    try {
      return (
        loadPostIdsPendingSecondModeration().length > 0 ||
        loadReplyIdsPendingSecondModeration().length > 0
      );
    } catch {
      return false;
    }
  }, [hasPendingContent, postScoresById, replyScoresById]);

  useEffect(() => {
    if (!authReady) return;
    if (!shouldPollTimeline) return;
    const id = window.setInterval(() => {
      void fetchPostsRef.current();
    }, 30000);
    return () => window.clearInterval(id);
  }, [authReady, shouldPollTimeline]);

  /** pending が消えた直後（cron 確定直後）に即再取得し、2行目取得 effect が確定本文を見られるようにする */
  const hadPendingContentRef = useRef(false);
  useEffect(() => {
    if (!authReady) return;
    if (hadPendingContentRef.current && !hasPendingContent) {
      const needSecond =
        loadPostIdsPendingSecondModeration().length > 0 ||
        loadReplyIdsPendingSecondModeration().length > 0;
      if (needSecond) void fetchPostsRef.current();
    }
    hadPendingContentRef.current = hasPendingContent;
  }, [authReady, hasPendingContent]);

  /** 本文確定後かつ編集窓終了後、確定本文で再採点し 2 行目を DB（moderation_dev_scores）へ保存 */
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;

    void (async () => {
      for (const postId of loadPostIdsPendingSecondModeration()) {
        if (cancelled) return;
        const post = posts.find((p) => p.id === postId);
        if (!post) {
          removePostNeedsSecondModeration(postId);
          continue;
        }
        if (post.pending_content?.trim()) continue;

        if (
          !isPastInitialEditWindow(post.created_at, nowTick)
        ) {
          continue;
        }

        const prev = postScoresByIdRef.current;
        const existingSecond = prev[postId]?.second;
        if (existingSecond && Object.keys(existingSecond).length > 0) {
          const busyKey = `p:${postId}`;
          if (secondModerationBusyRef.current.has(busyKey)) continue;
          secondModerationBusyRef.current.add(busyKey);
          try {
            const persistRes = await persistModerationDevScores({
              postId,
              patch: { second: existingSecond },
            });
            if (persistRes.ok) removePostNeedsSecondModeration(postId);
          } catch (e) {
            console.warn("persist second post:", e);
          } finally {
            secondModerationBusyRef.current.delete(busyKey);
          }
          continue;
        }

        const busyKey = `p:${postId}`;
        if (secondModerationBusyRef.current.has(busyKey)) continue;
        secondModerationBusyRef.current.add(busyKey);
        try {
          const text = (post.content ?? "").trim();
          if (!text) {
            removePostNeedsSecondModeration(postId);
            continue;
          }
          const scores = await fetchPerspectiveScoresForText(text);
          if (cancelled) return;
          if (Object.keys(scores).length === 0) {
            removePostNeedsSecondModeration(postId);
            continue;
          }
          setPostScoresById((p) => {
            if (p[postId]?.second) return p;
            const row = p[postId] ?? {};
            return { ...p, [postId]: { ...row, second: scores } };
          });
          const persistRes = await persistModerationDevScores({
            postId,
            patch: { second: scores },
          });
          if (persistRes.ok) removePostNeedsSecondModeration(postId);
        } catch (e) {
          console.warn("second moderation row:", e);
        } finally {
          secondModerationBusyRef.current.delete(busyKey);
        }
      }

      for (const replyId of loadReplyIdsPendingSecondModeration()) {
        if (cancelled) return;
        const reply = Object.values(repliesByPost)
          .flat()
          .find((r) => r.id === replyId);
        if (!reply) {
          removeReplyNeedsSecondModeration(replyId);
          continue;
        }
        if (reply.pending_content?.trim()) continue;

        if (
          !isPastInitialEditWindow(reply.created_at, nowTick)
        ) {
          continue;
        }

        const rprev = replyScoresByIdRef.current;
        const rExistingSecond = rprev[replyId]?.second;
        if (rExistingSecond && Object.keys(rExistingSecond).length > 0) {
          const busyKey = `r:${replyId}`;
          if (secondModerationBusyRef.current.has(busyKey)) continue;
          secondModerationBusyRef.current.add(busyKey);
          try {
            const persistRes = await persistModerationDevScores({
              replyId,
              patch: { second: rExistingSecond },
            });
            if (persistRes.ok) removeReplyNeedsSecondModeration(replyId);
          } catch (e) {
            console.warn("persist second reply:", e);
          } finally {
            secondModerationBusyRef.current.delete(busyKey);
          }
          continue;
        }

        const busyKey = `r:${replyId}`;
        if (secondModerationBusyRef.current.has(busyKey)) continue;
        secondModerationBusyRef.current.add(busyKey);
        try {
          const text = (reply.content ?? "").trim();
          if (!text) {
            removeReplyNeedsSecondModeration(replyId);
            continue;
          }
          const scores = await fetchPerspectiveScoresForText(text);
          if (cancelled) return;
          if (Object.keys(scores).length === 0) {
            removeReplyNeedsSecondModeration(replyId);
            continue;
          }
          setReplyScoresById((p) => {
            if (p[replyId]?.second) return p;
            const row = p[replyId] ?? {};
            return { ...p, [replyId]: { ...row, second: scores } };
          });
          const persistRes = await persistModerationDevScores({
            replyId,
            patch: { second: scores },
          });
          if (persistRes.ok) removeReplyNeedsSecondModeration(replyId);
        } catch (e) {
          console.warn("second moderation row (reply):", e);
        } finally {
          secondModerationBusyRef.current.delete(busyKey);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    posts,
    repliesByPost,
    postScoresById,
    replyScoresById,
    userId,
    nowTick,
  ]);

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
        .select("nickname, avatar_url, avatar_placeholder_hex")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        setErrorMessage(error.message);
        setProfileReady(true);
        return;
      }

      const nick = data?.nickname ?? null;
      setProfileNickname(nick);
      setProfileAvatarUrl(data?.avatar_url ?? null);
      setProfilePlaceholderHex(
        (data as { avatar_placeholder_hex?: string | null } | null)
          ?.avatar_placeholder_hex ?? null
      );
      setToxicityFilterLevel(
        await fetchToxicityFilterLevel(supabase, userId)
      );
      setProfileReady(true);
    })();
  }, [userId, user]);

  /** タイムライン本文（未ログインでも閲覧可）。ログイン済みかつプロフィール取得後にいいね取得 */
  useEffect(() => {
    if (!authReady) return;
    if (userId && !profileReady) return;

    void (async () => {
      try {
        await fetchPosts();
      } catch (err) {
        console.error("fetch error:", err);
        setErrorMessage("データの取得に失敗しました。");
      }
    })();
  }, [authReady, userId, profileReady, toxicityFilterLevel]);

  useEffect(() => {
    if (!userId || !profileReady || needsNickname) {
      if (!userId) {
        startTransition(() => setLikedPostIds(new Set()));
      }
      return;
    }

    void (async () => {
      try {
        await fetchLikes(userId);
      } catch (err) {
        console.error("likes fetch error:", err);
      }
    })();
  }, [userId, profileReady, needsNickname]);

  const signOut = async () => {
    setErrorMessage(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setLikedPostIds(new Set());
    setProfileNickname(null);
    setProfileAvatarUrl(null);
    setProfilePlaceholderHex(null);
    setProfileReady(false);
    setToxicityFilterLevel(DEFAULT_TOXICITY_FILTER_LEVEL);
    setNicknameDraft("");
    void fetchPosts();
  };

  const handleNicknameSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId) return;

    const result = validateNickname(nicknameDraft);
    if (!result.ok) {
      setNicknameModalError(result.message);
      return;
    }

    setNicknameModalError(null);
    const hex = pickAvatarPlaceholderHex();
    let savedPlaceholderHex: string | null = hex;
    let { error } = await supabase
      .from("users")
      .update({
        nickname: result.value,
        avatar_placeholder_hex: hex,
      })
      .eq("id", userId);

    if (error && isMissingAvatarPlaceholderHexError(error)) {
      savedPlaceholderHex = null;
      ({ error } = await supabase
        .from("users")
        .update({ nickname: result.value })
        .eq("id", userId));
    }

    if (error) {
      const pgErr = error as PostgrestError;
      if (pgErr.code === "23505") {
        setNicknameModalError("そのニックネームは既に使われています。");
        return;
      }
      const msg = (error.message ?? "").trim();
      setNicknameModalError(msg || "保存に失敗しました。");
      return;
    }

    setNicknameModalError(null);
    setProfileNickname(result.value);
    setProfilePlaceholderHex(savedPlaceholderHex);
    setNicknameDraft("");
    void fetchPosts();
  };

  const handleReplySubmit = async (postId: number) => {
    if (!userId) {
      setErrorMessage("ログインしてください。");
      return;
    }
    if (needsNickname) return;
    const content = (replyDrafts[postId] ?? "").trim();
    if (!content) return;
    if (replySubmittingPostId != null) return;

    const flat = repliesByPost[postId] ?? [];
    const parentReplyId: number | null = replyParentReplyId;
    const parentReply =
      parentReplyId != null ? flat.find((x) => x.id === parentReplyId) : null;
    if (parentReplyId != null) {
      if (!parentReply || parentReply.post_id !== postId) {
        setErrorMessage("返信先が見つかりません。");
        return;
      }
    }

    setReplySubmittingPostId(postId);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/moderate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: content,
          mode: moderationMode,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        overallMax?: number;
        mode?: string;
        degraded?: boolean;
        degradedReason?: string;
        paragraphs?: Array<{
          index: number;
          text: string;
          maxScore: number;
          scores: Record<string, number>;
        }>;
      };
      if (!res.ok) {
        setErrorMessage(json?.error ?? "AI判定に失敗しました。");
        return;
      }
      if (json.degraded) {
        setModerationDegradedMessage(
          json.degradedReason ??
            "APIの利用制限などにより、簡易チェックに切り替えました。"
        );
      } else {
        setModerationDegradedMessage(null);
      }

      const scores = normalizePerspectiveScores(
        json.paragraphs?.[0]?.scores as Record<string, unknown> | undefined
      );
      const overallMax =
        typeof json.overallMax === "number" ? json.overallMax : 0;

      const insertRow: {
        post_id: number;
        user_id: string;
        content: string;
        parent_reply_id?: number;
        moderation_max_score: number;
        moderation_dev_scores: { first: Record<string, number> } | null;
      } = {
        post_id: postId,
        user_id: userId,
        content,
        moderation_max_score: overallMax,
        moderation_dev_scores:
          Object.keys(scores).length > 0 ? { first: scores } : null,
      };
      if (parentReplyId != null) {
        insertRow.parent_reply_id = parentReplyId;
      }

      const { data: insertedReply, error } = await supabase
        .from("post_replies")
        .insert(insertRow)
        .select("id")
        .single();

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      if (insertedReply) {
        markReplyNeedsSecondModeration(insertedReply.id);
        if (Object.keys(scores).length > 0) {
          setReplyScoresById((prev) => ({
            ...prev,
            [insertedReply.id]: { first: scores },
          }));
        }
      }

      const targetUserId =
        parentReply?.user_id ??
        posts.find((p) => p.id === postId)?.user_id ??
        null;
      if (
        insertedReply &&
        targetUserId &&
        targetUserId !== userId &&
        overallMax > RELATION_PENALTY_MIN_SCORE
      ) {
        const { error: evErr } = await supabase
          .from("reply_toxic_events")
          .insert({
            actor_user_id: userId,
            target_user_id: targetUserId,
            post_id: postId,
            reply_id: insertedReply.id,
            max_score: overallMax,
          });
        if (evErr) {
          console.warn("reply_toxic_events insert failed:", evErr.message);
        }
      }

      setReplyDrafts((prev) => ({ ...prev, [postId]: "" }));
      setReplyParentReplyId(null);
      if (overallMax >= HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD) {
        setToastMessage(REPLY_HIGH_TOXICITY_VISIBILITY_NOTICE);
      }
      await fetchPosts();
    } catch (err) {
      console.error("reply moderation error:", err);
      setErrorMessage("AI判定に失敗しました。");
    } finally {
      setReplySubmittingPostId(null);
    }
  };

  const handleDeleteReply = async (replyId: number) => {
    if (!userId) return;
    if (!window.confirm("この返信を削除しますか？")) return;
    setErrorMessage(null);
    const { error } = await supabase
      .from("post_replies")
      .delete()
      .eq("id", replyId);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    if (editingReplyId === replyId) setEditingReplyId(null);
    await fetchPosts();
  };

  const handleSaveReplyEdit = async (replyId: number) => {
    if (!userId) return;
    const content = editReplyDraft.trim();
    if (!content) {
      setErrorMessage("本文を入力してください。");
      return;
    }
    setReplyEditSaving(true);
    setErrorMessage(null);
    const { error } = await supabase
      .from("post_replies")
      .update({ pending_content: content })
      .eq("id", replyId)
      .eq("user_id", userId);
    setReplyEditSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setEditingReplyId(null);
    markReplyNeedsSecondModeration(replyId);
    setToastMessage("編集を保存しました。15分後に反映されます。");
    await fetchPosts();
  };

  const handleDeletePost = async (
    postId: number,
    imageStoragePath?: string | null
  ) => {
    if (!userId) return;
    if (!window.confirm("この投稿を削除しますか？")) return;
    setErrorMessage(null);
    await removePostImageIfAny(supabase, imageStoragePath);
    const { error } = await supabase
      .from("posts")
      .delete()
      .eq("id", postId)
      .eq("user_id", userId);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    if (editingPostId === postId) setEditingPostId(null);
    await fetchPosts();
  };

  const handleSavePostEdit = async (postId: number) => {
    if (!userId) return;
    const content = editDraft.trim();
    const existing = posts.find((p) => p.id === postId);
    const hasImage = Boolean(existing?.image_storage_path?.trim());
    if (!content) {
      setErrorMessage(
        hasImage
          ? "画像を付けた投稿には本文が必要です。本文を入力してください。"
          : "本文を入力してください。"
      );
      return;
    }
    setPostEditSaving(true);
    setErrorMessage(null);
    const { error } = await supabase
      .from("posts")
      .update({ pending_content: content })
      .eq("id", postId)
      .eq("user_id", userId);
    setPostEditSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setEditingPostId(null);
    markPostNeedsSecondModeration(postId);
    setToastMessage("編集を保存しました。15分後に反映されます。");
    await fetchPosts();
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId) {
      setErrorMessage("ログインしてください。");
      return;
    }
    if (needsNickname) return;
    const textContent = input.trim();
    if (!textContent && !composePostImage) return;
    if (!textContent && composePostImage) {
      setErrorMessage("画像を添付する場合は本文を入力してください。");
      return;
    }

    setPostSubmitting(true);
    setErrorMessage(null);

    let postOverallMax = 0;
    let postScores: Record<string, number> = {};

    if (textContent) {
      try {
        const res = await fetch("/api/moderate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: textContent,
            mode: moderationMode,
          }),
        });
        const json = (await res.json()) as {
          error?: string;
          overallMax?: number;
          mode?: "auto" | "mock" | "perspective";
          truncated?: boolean;
          paragraphs?: Array<{
            index: number;
            text: string;
            maxScore: number;
            scores: Record<string, number>;
          }>;
          degraded?: boolean;
          degradedReason?: string;
        };
        if (!res.ok) {
          setErrorMessage(json?.error ?? "AI判定に失敗しました。");
          setPostSubmitting(false);
          return;
        }
        if (json.degraded) {
          setModerationDegradedMessage(
            json.degradedReason ??
              "APIの利用制限などにより、簡易チェックに切り替えました。"
          );
        } else {
          setModerationDegradedMessage(null);
        }
        postScores = normalizePerspectiveScores(
          json.paragraphs?.[0]?.scores as Record<string, unknown> | undefined
        );
        let maxFromApi =
          typeof json.overallMax === "number" ? json.overallMax : 0;
        if (maxFromApi === 0 && Object.keys(postScores).length > 0) {
          maxFromApi = Math.max(...Object.values(postScores));
        }
        postOverallMax = maxFromApi;
      } catch (err) {
        console.error("moderation error:", err);
        setErrorMessage("AI判定に失敗しました。");
        setPostSubmitting(false);
        return;
      }
    }

    const { data, error } = await supabase
      .from("posts")
      .insert({
        content: textContent,
        user_id: userId,
        moderation_max_score: postOverallMax,
        moderation_dev_scores:
          Object.keys(postScores).length > 0
            ? { first: postScores }
            : null,
      })
      .select()
      .single();

    if (error) {
      console.error("insert error:", error);
      setErrorMessage(error.message);
      setPostSubmitting(false);
      return;
    }

    if (!data) {
      setPostSubmitting(false);
      return;
    }

    if (composePostImage) {
      const up = await uploadPostImage(
        supabase,
        userId,
        data.id,
        composePostImage
      );
      if (!up.ok) {
        await supabase.from("posts").delete().eq("id", data.id);
        setErrorMessage(up.message);
        setPostSubmitting(false);
        return;
      }
      const { error: updErr } = await supabase
        .from("posts")
        .update({ image_storage_path: up.path })
        .eq("id", data.id)
        .eq("user_id", userId);
      if (updErr) {
        await removePostImageIfAny(supabase, up.path);
        await supabase.from("posts").delete().eq("id", data.id);
        setErrorMessage(updErr.message);
        setPostSubmitting(false);
        return;
      }
    }

    markPostNeedsSecondModeration(data.id);
    if (Object.keys(postScores).length > 0) {
      setPostScoresById((prev) => ({
        ...prev,
        [data.id]: { first: postScores },
      }));
    }
    setInput("");
    setComposePostImage(null);
    setComposeOpen(false);
    if (postOverallMax >= HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD) {
      setToastMessage(POST_HIGH_TOXICITY_VISIBILITY_NOTICE);
    }
    await fetchPosts();
    setPostSubmitting(false);
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

    const authorId = posts.find((p) => p.id === postId)?.user_id;
    if (authorId && authorId !== userId) {
      const { error: affErr } = await supabase.rpc(
        "apply_user_affinity_on_like",
        { p_liker: userId, p_author: authorId }
      );
      if (affErr) {
        console.warn("user_affinity rpc:", affErr.message);
      }
    }

    setErrorMessage(null);
    setLikedPostIds((prev) => {
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
    void fetchPostsRef.current();
  };

  const canInteract =
    Boolean(userId) && profileReady && !needsNickname;

  /** スキ・返信・投稿など。ブロック時はモーダル用メッセージを返す */
  const interactionBlockedMessage = (): string | null => {
    if (!authReady) {
      return "読み込み中です。";
    }
    if (!userId) {
      return "スキや投稿にはログインが必要です。";
    }
    if (!profileReady) {
      return "プロフィールを読み込み中です。";
    }
    return null;
  };

  const tryInteraction = (): boolean => {
    if (needsNickname) return false;
    const msg = interactionBlockedMessage();
    if (msg) {
      setAuthGateModal({ open: true, message: msg });
      return false;
    }
    return true;
  };

  return (
    <main
      className={[
        "min-h-screen text-gray-900",
        moderationDegradedMessage
          ? "bg-amber-50"
          : moderationMode === "mock"
            ? "bg-rose-50"
            : "bg-sky-50",
      ].join(" ")}
    >
      <SiteHeader
        authReady={authReady}
        user={user}
        profileNickname={profileNickname}
        profileAvatarUrl={profileAvatarUrl}
        avatarPlaceholderHex={profilePlaceholderHex}
        onSignOut={signOut}
      />

      <div className="mx-auto max-w-xl p-4 sm:p-6">
        {moderationDegradedMessage ? (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-100 p-3 text-sm text-amber-950">
            {moderationDegradedMessage}
          </div>
        ) : null}

        {errorMessage?.trim() ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errorMessage}
          </div>
        ) : null}
        {authReady && !(userId && !profileReady) ? (
          <>
            {canInteract && composeOpen ? (
              <div className="fixed inset-x-4 bottom-20 z-[55] md:inset-x-auto md:right-6 md:w-[34rem]">
                <form
                  onSubmit={handleSubmit}
                  className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
                >
                  <details className="rounded-md border border-gray-200 bg-gray-50 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-gray-800">
                      AI判定（テスト用）
                    </summary>
                    <div className="mt-3 grid gap-3 text-sm">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                        <label className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap">
                          <span className="shrink-0 text-gray-600">モード</span>
                          <select
                            className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1"
                            value={moderationMode}
                            onChange={(e) =>
                              setModerationMode(
                                e.target.value as "mock" | "perspective"
                              )
                            }
                          >
                            <option value="mock">mock（簡易）</option>
                            <option value="perspective">AI判定</option>
                          </select>
                          {moderationMode === "mock" ? (
                            <span className="min-w-0 flex-1 text-xs font-semibold text-red-700">
                              ※簡易モードは特定NGワードのみ検出
                            </span>
                          ) : (
                            <span className="min-w-0 flex-1 text-xs font-semibold text-red-700">
                              ※AI判定は現状1日の使用量上限あり
                            </span>
                          )}
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
                    </div>
                  </details>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="いまどうしてる？"
                    rows={4}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                  />
                  <div className="flex flex-col gap-2">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      disabled={postSubmitting}
                      aria-label="画像を添付"
                      className="max-w-full text-sm text-gray-800 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-gray-500 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-800 hover:file:bg-gray-100"
                      onChange={(e) => {
                        void (async () => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) {
                            setComposePostImage(null);
                            return;
                          }
                          const r = await preparePostImageForUpload(file);
                          if (!r.ok) {
                            setErrorMessage(r.message);
                            return;
                          }
                          setErrorMessage(null);
                          setComposePostImage({
                            blob: r.blob,
                            contentType: r.contentType,
                            ext: r.ext,
                          });
                        })();
                      }}
                    />
                    {composeImagePreviewUrl ? (
                      <div className="flex flex-wrap items-end gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={composeImagePreviewUrl}
                          alt=""
                          className="max-h-40 rounded border border-gray-200 object-contain"
                        />
                        <button
                          type="button"
                          disabled={postSubmitting}
                          onClick={() => setComposePostImage(null)}
                          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          画像を外す
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={postSubmitting}
                      className="rounded-md bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {postSubmitting ? "投稿中…" : "投稿"}
                    </button>
                    <button
                      type="button"
                      disabled={postSubmitting}
                      onClick={() => {
                        setComposeOpen(false);
                        setInput("");
                        setComposePostImage(null);
                      }}
                      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      キャンセル
                    </button>
                  </div>
                </form>
              </div>
            ) : null}

            <section>
              {posts.length === 0 ? (
                <p className="text-sm text-gray-500">
                  まだ投稿がありません。
                </p>
              ) : (
                <ul className="space-y-3">
                  {posts.map((post) => (
                <li
                  key={post.id}
                  className="break-words rounded-lg border border-gray-200 bg-white p-4"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {post.user_id ? (
                        <Link
                          href={`/home/${post.user_id}`}
                          className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-800 hover:text-blue-800"
                        >
                          <UserAvatar
                            name={post.users?.nickname ?? null}
                            avatarUrl={post.users?.avatar_url ?? null}
                            placeholderHex={
                              post.users?.avatar_placeholder_hex ?? null
                            }
                          />
                          <span className="truncate underline decoration-blue-200 underline-offset-2">
                            {post.users?.nickname ?? "（未設定）"}
                          </span>
                        </Link>
                      ) : (
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                          <UserAvatar
                            name={post.users?.nickname ?? null}
                            avatarUrl={post.users?.avatar_url ?? null}
                            placeholderHex={
                              post.users?.avatar_placeholder_hex ?? null
                            }
                          />
                          <span>{post.users?.nickname ?? "（未設定）"}</span>
                        </div>
                      )}
                    </div>
                    {canInteract &&
                    userId &&
                    post.user_id &&
                    post.user_id === userId ? (
                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        {canEditOwnPost(post.created_at, userId, post.user_id) ? (
                          <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
                            編集残り{" "}
                            {formatRemainingLabel(
                              getEditRemainingMs(post.created_at, nowTick)
                            )}
                          </span>
                        ) : null}
                        {canEditOwnPost(
                          post.created_at,
                          userId,
                          post.user_id
                        ) ? (
                          editingPostId === post.id ? (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPostId(null);
                              }}
                              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 hover:bg-gray-50"
                            >
                              編集をやめる
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPostId(post.id);
                                setEditDraft(post.pending_content ?? post.content);
                              }}
                              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 hover:bg-gray-50"
                            >
                              編集
                            </button>
                          )
                        ) : null}
                        <button
                          type="button"
                          onClick={() =>
                            void handleDeletePost(
                              post.id,
                              post.image_storage_path
                            )
                          }
                          className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                        >
                          削除
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm text-gray-500">
                    {post.created_at
                      ? new Date(post.created_at).toLocaleString()
                      : ""}
                  </div>
                  {(() => {
                    const postImg = getPostImagePublicUrl(
                      supabase,
                      post.image_storage_path
                    );
                    return postImg ? (
                      <div className="mt-2 overflow-hidden rounded-md border border-gray-100 bg-gray-50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={postImg}
                          alt=""
                          className="max-h-96 w-full object-contain"
                          loading="lazy"
                        />
                      </div>
                    ) : null;
                  })()}
                  {editingPostId === post.id ? (
                    <div className="mt-1 space-y-2">
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={5}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                        disabled={postEditSaving}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={postEditSaving}
                          onClick={() => void handleSavePostEdit(post.id)}
                          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {postEditSaving ? "保存中…" : "保存"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 whitespace-pre-wrap break-words">
                      {renderTextWithLinks(
                        resolvePendingVisibleContent(
                          post.content,
                          post.pending_content,
                          post.created_at,
                          nowTick
                        )
                      )}
                    </div>
                  )}
                  {postScoresById[post.id]?.first ||
                  postScoresById[post.id]?.second ? (
                    <div className="mt-1 space-y-1 rounded border border-gray-100 bg-gray-50/80 px-2 py-1">
                      {postScoresById[post.id]?.first ? (
                        <ModerationCompactRow
                          scores={postScoresById[post.id]!.first!}
                        />
                      ) : null}
                      {postScoresById[post.id]?.second ? (
                        <ModerationCompactRow
                          scores={postScoresById[post.id]!.second!}
                        />
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!(
                      userId &&
                      post.user_id &&
                      post.user_id === userId
                    ) ? (
                      (() => {
                        const liked =
                          canInteract && likedPostIds.has(post.id);
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              if (!tryInteraction()) return;
                              void handleLike(post.id);
                            }}
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
                        );
                      })()
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (!tryInteraction()) return;
                        if (replyComposerPostId === post.id) {
                          setReplyComposerPostId(null);
                          setReplyParentReplyId(null);
                        } else {
                          setReplyComposerPostId(post.id);
                          setReplyParentReplyId(null);
                        }
                      }}
                      className={[
                        "rounded-md border px-3 py-1 text-sm font-medium transition-colors",
                        replyComposerPostId === post.id
                          ? "border-blue-400 bg-blue-50 text-blue-800"
                          : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50",
                      ].join(" ")}
                      aria-expanded={replyComposerPostId === post.id}
                    >
                      {replyComposerPostId === post.id
                        ? "返信を閉じる"
                        : "返信"}
                    </button>
                  </div>
                  {(repliesByPost[post.id] ?? []).length > 0 ? (
                    <div className="mt-3 border-t border-gray-100 pt-3 text-sm">
                      {(() => {
                        const flat = repliesByPost[post.id] ?? [];
                        const { roots, childrenByParent } =
                          partitionRepliesByParent(flat);
                        return (
                          <ReplyThread
                            roots={roots}
                            childrenByParent={childrenByParent}
                            userId={userId}
                            canInteract={canInteract}
                            nowTick={nowTick}
                            editingReplyId={editingReplyId}
                            editReplyDraft={editReplyDraft}
                            replyEditSaving={replyEditSaving}
                            replyVisibilityThreshold={
                              userId
                                ? thresholdForLevel(toxicityFilterLevel)
                                : ANON_TOXICITY_VIEW_THRESHOLD
                            }
                            replyScoresById={replyScoresById}
                            onEditDraftChange={setEditReplyDraft}
                            onStartEdit={(r) => {
                              setEditingReplyId(r.id);
                              setEditReplyDraft(r.pending_content ?? r.content);
                            }}
                            onCancelEdit={() => setEditingReplyId(null)}
                            onSaveEdit={(rid) => void handleSaveReplyEdit(rid)}
                            onDelete={handleDeleteReply}
                            onReplyToReply={(parentReplyId) => {
                              setReplyComposerPostId(post.id);
                              setReplyParentReplyId(parentReplyId);
                            }}
                          />
                        );
                      })()}
                    </div>
                  ) : null}
                  {canInteract && replyComposerPostId === post.id ? (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      {replyParentReplyId != null ? (
                        <p className="mb-2 text-xs text-gray-600">
                          選択した返信への返信を入力しています。
                        </p>
                      ) : null}
                      <textarea
                        value={replyDrafts[post.id] ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setReplyDrafts((prev) => ({
                            ...prev,
                            [post.id]: v,
                          }));
                        }}
                        rows={3}
                        maxLength={2000}
                        placeholder={
                          replyParentReplyId != null
                            ? "この返信への返信を入力…"
                            : "返信を入力…"
                        }
                        autoFocus
                        className="mb-2 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={replySubmittingPostId === post.id}
                          onClick={() => void handleReplySubmit(post.id)}
                          className="rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-900 disabled:opacity-50"
                        >
                          {replySubmittingPostId === post.id
                            ? "送信中…"
                            : "返信する"}
                        </button>
                        <button
                          type="button"
                          disabled={replySubmittingPostId === post.id}
                          onClick={() => {
                            setReplyComposerPostId(null);
                            setReplyParentReplyId(null);
                          }}
                          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
                  ))}
                </ul>
              )}
            </section>
            {!needsNickname ? (
              <button
                type="button"
                onClick={() => {
                  if (!tryInteraction()) return;
                  setComposeOpen((prev) => {
                    if (prev) {
                      setInput("");
                      setComposePostImage(null);
                    }
                    return !prev;
                  });
                }}
                className="fixed bottom-5 right-5 z-[10001] inline-flex h-12 w-12 items-center justify-center rounded-full border border-blue-200 bg-blue-600 text-2xl font-semibold text-white shadow-lg hover:bg-blue-700"
                aria-label="投稿フォームを開く"
                title="投稿"
              >
                {composeOpen && canInteract ? "×" : "+"}
              </button>
            ) : null}
          </>
        ) : null}

        {userId && !profileReady ? (
          <p className="text-gray-600">プロフィールを読み込み中…</p>
        ) : null}
      </div>

      {authGateModal.open ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          onClick={() => setAuthGateModal({ open: false, message: "" })}
        >
          <p className="pointer-events-none max-w-xs rounded-lg border border-gray-200 bg-white px-4 py-3 text-center text-sm text-gray-800 shadow-lg">
            {authGateModal.message}
          </p>
        </div>
      ) : null}

      <NicknameRequiredModal
        open={Boolean(userId && profileReady && needsNickname)}
        nicknameDraft={nicknameDraft}
        onNicknameDraftChange={(v) => {
          setNicknameModalError(null);
          setNicknameDraft(v);
        }}
        onSubmit={handleNicknameSubmit}
        errorMessage={nicknameModalError}
      />

      {toastMessage?.trim() ? (
        <div
          className="pointer-events-none fixed bottom-24 left-1/2 z-[10002] max-w-[min(92vw,28rem)] -translate-x-1/2 rounded-lg border border-gray-200 bg-gray-900 px-4 py-2.5 text-center text-sm text-white shadow-lg"
          role="status"
          aria-live="polite"
        >
          {toastMessage}
        </div>
      ) : null}

    </main>
  );
}
