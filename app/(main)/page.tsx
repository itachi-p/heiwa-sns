"use client";

import React, {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { AutosizeTextarea } from "@/components/autosize-textarea";
import { EditCountdownBadge } from "@/components/edit-countdown-badge";
import { ImageAttachIconButton } from "@/components/image-attach-icon-button";
import { COMPOSE_OPEN_EVENT } from "@/components/compose-open-bus";
import { AppToastPortal } from "@/components/app-toast-portal";
import { VIEWER_TOXICITY_UPDATED_EVENT } from "@/components/viewer-toxicity-bus";
import { MustChangePasswordModal } from "@/components/must-change-password-modal";
import { ReplyBubbleIcon } from "@/components/reply-composer-modal";
import { ReplyThread } from "@/components/reply-thread";
import { SiteHeader } from "@/components/site-header";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";
import { ModerationCompactRow } from "@/components/moderation-compact-row";
import { normalizePerspectiveScores } from "@/lib/perspective-labels";
import {
  ANON_TOXICITY_VIEW_THRESHOLD,
  fetchToxicityOverThresholdBehavior,
  fetchToxicityFilterLevel,
} from "@/lib/timeline-threshold";
import {
  POST_HIGH_TOXICITY_VISIBILITY_NOTICE,
  REPLY_HIGH_TOXICITY_VISIBILITY_NOTICE,
} from "@/lib/visibility-notice";
import {
  DEFAULT_TOXICITY_FILTER_LEVEL,
  DEFAULT_TOXICITY_OVER_THRESHOLD_BEHAVIOR,
  effectiveScoreForViewerToxicityFilter,
  HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD,
  thresholdForLevel,
  type ToxicityOverThresholdBehavior,
  type ToxicityFilterLevel,
} from "@/lib/toxicity-filter-level";
import { POST_AND_REPLY_MAX_CHARS } from "@/lib/compose-text-limits";
import {
  canEditOwnPost,
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
    public_id?: string | null;
  } | null;
};

const RELATION_PENALTY_MIN_SCORE = 0.2;
const RELATION_PENALTY_WINDOW_DAYS = 14;
const TIMELINE_PAGE_SIZE = 20;
const TIMELINE_SNAPSHOT_KEY = "timeline_snapshot_v1";

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
    public_id?: string | null;
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

function displayName(
  nickname: string | null | undefined,
  publicId: string | null | undefined
): string {
  const nick = (nickname ?? "").trim();
  if (nick) return nick;
  const pid = (publicId ?? "").trim();
  return pid || "（未設定）";
}

async function fetchPublicProfilesByIds(userIds: string[]) {
  if (userIds.length === 0) return [] as Array<{
    id: string;
    nickname: string | null;
    avatar_url?: string | null;
    avatar_placeholder_hex?: string | null;
    public_id?: string | null;
  }>;
  const res = await fetch("/api/public-profiles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userIds }),
  });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as
    | {
        profiles?: Array<{
          id: string;
          nickname: string | null;
          avatar_url?: string | null;
          avatar_placeholder_hex?: string | null;
          public_id?: string | null;
        }>;
      }
    | null;
  return Array.isArray(json?.profiles) ? json.profiles : [];
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
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [inviteLabel, setInviteLabel] = useState<string | null>(null);
  const [inviteOnboardingCompleted, setInviteOnboardingCompleted] =
    useState(true);
  /** users.toxicity_filter_level（タイムライン・リプの閾値は TOXICITY_THRESHOLDS で導出） */
  const [toxicityFilterLevel, setToxicityFilterLevel] =
    useState<ToxicityFilterLevel>(DEFAULT_TOXICITY_FILTER_LEVEL);
  const [toxicityOverThresholdBehavior, setToxicityOverThresholdBehavior] =
    useState<ToxicityOverThresholdBehavior>(
      DEFAULT_TOXICITY_OVER_THRESHOLD_BEHAVIOR
    );
  const [expandedFoldedPosts, setExpandedFoldedPosts] = useState<Set<number>>(
    () => new Set()
  );
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
  const [posts, setPosts] = useState<Post[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineLoadingMore, setTimelineLoadingMore] = useState(false);
  const [timelineHasMore, setTimelineHasMore] = useState(true);
  const [timelineOffset, setTimelineOffset] = useState(0);
  const [input, setInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** 数秒で消える通知（編集保存・注意など） */
  type ToastState = { message: string; tone: "default" | "error" };
  const [toast, setToast] = useState<ToastState | null>(null);
  /*
   * 編集窓（投稿から15分）が切れるタイミングで 1 回だけ再レンダーする仕掛け。
   * 詳細は home/page.tsx の同名 state のコメントを参照。
   */
  const [expiryTick, setExpiryTick] = useState(0);
  const [likedPostIds, setLikedPostIds] = useState<Set<number>>(
    () => new Set()
  );
  const [likedReplyIds, setLikedReplyIds] = useState<Set<number>>(
    () => new Set()
  );
  const [moderationMode] = useState<"mock" | "perspective">("perspective");
  const [moderationDegradedMessage, setModerationDegradedMessage] = useState<
    string | null
  >(null);
  const [repliesByPost, setRepliesByPost] = useState<
    Record<number, PostReply[]>
  >({});
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [inlineReplyPostId, setInlineReplyPostId] = useState<number | null>(null);
  const [openedReplyPosts, setOpenedReplyPosts] = useState<Set<number>>(
    () => new Set()
  );
  const [replySubmittingPostId, setReplySubmittingPostId] = useState<
    number | null
  >(null);
  /** 返信入力を開いている投稿（タップで開閉） */
  const [replyComposerPostId, setReplyComposerPostId] = useState<number | null>(
    null
  );
  const [composeOpen, setComposeOpen] = useState(false);
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [composePostImage, setComposePostImage] =
    useState<PreparedPostImage | null>(null);
  const [composeImagePreviewUrl, setComposeImagePreviewUrl] = useState<
    string | null
  >(null);
  const composeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [authGateModal, setAuthGateModal] = useState<{
    open: boolean;
    message: string;
  }>({ open: false, message: "" });
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
  const loadedProfileUserIdRef = useRef<string | null>(null);
  postScoresByIdRef.current = postScoresById;
  replyScoresByIdRef.current = replyScoresById;
  const userId = user?.id ?? null;

  const needsPasswordChange =
    Boolean(userId) && profileReady && mustChangePassword;
  const needsInviteOnboarding =
    Boolean(userId) && profileReady && !inviteOnboardingCompleted;
  const needsNickname = false;

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(TIMELINE_SNAPSHOT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        posts?: Post[];
        repliesByPost?: Record<number, PostReply[]>;
      };
      if (Array.isArray(parsed.posts) && parsed.posts.length > 0) {
        setPosts(parsed.posts);
        setTimelineLoading(false);
      }
      if (parsed.repliesByPost && typeof parsed.repliesByPost === "object") {
        setRepliesByPost(parsed.repliesByPost);
      }
    } catch {
      // Ignore malformed cache and continue normal loading.
    }
  }, []);

  useEffect(() => {
    if (!toast?.message?.trim()) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const open = () => setComposeOpen(true);
    window.addEventListener(COMPOSE_OPEN_EVENT, open);
    return () => window.removeEventListener(COMPOSE_OPEN_EVENT, open);
  }, []);

  useEffect(() => {
    if (!composeOpen) return;
    const id = window.requestAnimationFrame(() => {
      composeTextareaRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [composeOpen]);

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

  /**
   * 自分の投稿/返信のうち、まだ編集可能な最短の期限に合わせて setTimeout で
   * expiryTick を進める。詳細は home/page.tsx の同等 useEffect のコメントを参照。
   */
  useEffect(() => {
    if (!userId) return;
    let next = Infinity;
    const now = Date.now();
    const consider = (
      createdAt: string | undefined,
      authorId: string | undefined
    ) => {
      if (!authorId || authorId !== userId) return;
      const remaining = getEditRemainingMs(createdAt, now);
      if (remaining <= 0) return;
      const expiresAt = now + remaining;
      if (expiresAt < next) next = expiresAt;
    };
    for (const p of posts) consider(p.created_at, p.user_id);
    for (const list of Object.values(repliesByPost)) {
      for (const r of list) consider(r.created_at, r.user_id);
    }
    if (!Number.isFinite(next)) return;
    const delay = Math.max(0, next - now) + 50;
    const id = window.setTimeout(
      () => setExpiryTick((x) => x + 1),
      delay
    );
    return () => window.clearTimeout(id);
  }, [userId, posts, repliesByPost, expiryTick]);

  useEffect(() => {
    setExpandedFoldedPosts(new Set());
  }, [toxicityOverThresholdBehavior, toxicityFilterLevel, userId]);

  useEffect(() => {
    if (editingPostId != null) {
      const post = posts.find((p) => p.id === editingPostId);
      if (post && getEditRemainingMs(post.created_at) <= 0) {
        setEditingPostId(null);
        setToast({
          message:
            "編集時間が終了しました。保存済みの内容は投稿から15分後に反映されます。",
          tone: "default",
        });
      }
    }
    if (editingReplyId != null) {
      const allReplies = Object.values(repliesByPost).flat();
      const reply = allReplies.find((r) => r.id === editingReplyId);
      if (reply && getEditRemainingMs(reply.created_at) <= 0) {
        setEditingReplyId(null);
        setToast({
          message:
            "編集時間が終了しました。保存済みの内容は投稿から15分後に反映されます。",
          tone: "default",
        });
      }
    }
  }, [expiryTick, editingPostId, editingReplyId, posts, repliesByPost]);

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

  const fetchPosts = async (opts?: { append?: boolean; quiet?: boolean }) => {
    const append = opts?.append === true;
    const quiet = opts?.quiet === true;
    if (append) {
      if (timelineLoading || timelineLoadingMore || !timelineHasMore) return;
      setTimelineLoadingMore(true);
    } else {
      if (!quiet) {
        // Keep existing rows on screen for refreshes; show full loading only at first load.
        setTimelineLoading(posts.length === 0);
      }
      setTimelineHasMore(true);
      setTimelineOffset(0);
    }
    try {
    if (userId && !append) {
      // 表示を優先し、重い確定処理はバックグラウンドで走らせる。
      void fetch("/api/finalize-my-pending", {
        method: "POST",
        credentials: "same-origin",
      }).catch(() => {
        /* 確定 API が失敗しても一覧取得は続行 */
      });
    }
    const start = append ? timelineOffset : 0;
    const end = start + TIMELINE_PAGE_SIZE - 1;
    const { data: rows, error } = await supabase
      .from("posts")
      .select("*")
      .range(start, end)
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const pageRows = (rows ?? []) as Post[];
    setTimelineHasMore(pageRows.length === TIMELINE_PAGE_SIZE);
    setTimelineOffset(start + pageRows.length);
    const list = append
      ? ([
          ...posts,
          ...pageRows.filter((r) => !posts.some((p) => p.id === r.id)),
        ] as Post[])
      : pageRows;
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
        public_id: string | null;
      }
    >();
    const profilePromise = authorIds.length > 0
      ? supabase
          .from("users")
          .select("id, nickname, avatar_url, avatar_placeholder_hex, public_id")
          .in("id", authorIds)
      : Promise.resolve({ data: null, error: null });

    const relationPromise = userId
      ? (() => {
          const since = new Date(
            Date.now() - RELATION_PENALTY_WINDOW_DAYS * 24 * 60 * 60 * 1000
          ).toISOString();
          return supabase
            .from("reply_toxic_events")
            .select("actor_user_id, max_score")
            .eq("target_user_id", userId)
            .gte("created_at", since);
        })()
      : Promise.resolve({ data: null, error: null });

    const affinityPromise = userId
      ? supabase
          .from("user_affinity")
          .select("to_user_id, like_score")
          .eq("from_user_id", userId)
      : Promise.resolve({ data: null, error: null });

    const [
      { data: profiles, error: profileError },
      { data: evRows, error: evErr },
      { data: affRows, error: affErr },
    ] = await Promise.all([profilePromise, relationPromise, affinityPromise]);

    const fallbackProfiles =
      profileError != null ? await fetchPublicProfilesByIds(authorIds) : [];
    for (const row of (profileError ? fallbackProfiles : profiles ?? [])) {
      profileByUserId.set(row.id, {
        nickname: row.nickname,
        avatar_url: row.avatar_url ?? null,
        avatar_placeholder_hex:
          (row as { avatar_placeholder_hex?: string | null })
            .avatar_placeholder_hex ?? null,
        public_id:
          typeof (row as { public_id?: string | null }).public_id === "string"
            ? String(
                (row as { public_id?: string | null }).public_id
              ).trim() || null
            : null,
      });
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
        public_id: p.user_id
          ? (profileByUserId.get(p.user_id)?.public_id ?? null)
          : null,
      },
    }));

    const relationMultiplierByAuthor = new Map<string, number>();
    if (userId && !evErr) {
      for (const row of evRows ?? []) {
        const actor = row.actor_user_id as string;
        const m = Math.max(0.5, Math.min(0.8, 1 - Number(row.max_score ?? 0)));
        relationMultiplierByAuthor.set(
          actor,
          Math.min(relationMultiplierByAuthor.get(actor) ?? 1, m)
        );
      }
    }

    const affinityLikeScoreByAuthor = new Map<string, number>();
    if (userId && !affErr) {
      for (const row of affRows ?? []) {
        const toId = row.to_user_id as string;
        affinityLikeScoreByAuthor.set(
          toId,
          typeof row.like_score === "number" ? row.like_score : 0
        );
      }
    }

    const viewThreshold = userId
      ? thresholdForLevel(toxicityFilterLevel)
      : ANON_TOXICITY_VIEW_THRESHOLD;

    const visibleForTimeline =
      toxicityOverThresholdBehavior === "hide"
        ? merged.filter((p) => {
            const score = effectiveScoreForViewerToxicityFilter(
              p.moderation_max_score
            );
            if (userId && p.user_id === userId) return true;
            return score <= viewThreshold;
          })
        : merged;

    const timelinePosts = sortTimelinePosts(
      visibleForTimeline,
      userId,
      affinityLikeScoreByAuthor,
      relationMultiplierByAuthor
    );

    setPosts(timelinePosts);

    const postIds = timelinePosts.map((p) => p.id);
    let replyRowsFlat: PostReply[] = [];
    let snapshotRepliesByPost: Record<number, PostReply[]> = {};
    if (postIds.length === 0) {
      setRepliesByPost({});
      snapshotRepliesByPost = {};
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
          public_id: string | null;
        }
      >();
      if (replyAuthorIds.length > 0) {
        const { data: rprofiles, error: rpe } = await supabase
          .from("users")
          .select("id, nickname, avatar_url, avatar_placeholder_hex, public_id")
          .in("id", replyAuthorIds);
        const fallbackReplyProfiles =
          rpe != null ? await fetchPublicProfilesByIds(replyAuthorIds) : [];
        for (const row of (rpe ? fallbackReplyProfiles : rprofiles ?? [])) {
          replyProfileByUserId.set(row.id, {
            nickname: row.nickname,
            avatar_url: row.avatar_url ?? null,
            avatar_placeholder_hex:
              (row as { avatar_placeholder_hex?: string | null })
                .avatar_placeholder_hex ?? null,
            public_id:
              typeof (row as { public_id?: string | null }).public_id ===
              "string"
                ? String(
                    (row as { public_id?: string | null }).public_id
                  ).trim() || null
                : null,
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
            public_id: rp?.public_id ?? null,
          },
        });
        byPost[r.post_id] = arr;
      }
      setRepliesByPost(byPost);
      snapshotRepliesByPost = byPost;
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
    try {
      window.sessionStorage.setItem(
        TIMELINE_SNAPSHOT_KEY,
        JSON.stringify({
          posts: timelinePosts,
          repliesByPost: snapshotRepliesByPost,
        })
      );
    } catch {
      // Storage can fail in private mode/quota limits; non-fatal.
    }
    } finally {
      setTimelineLoading(false);
      setTimelineLoadingMore(false);
    }
  };

  const fetchPostsRef = useRef(fetchPosts);
  useEffect(() => {
    fetchPostsRef.current = fetchPosts;
  });
  const timelineLoadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!userId) return;
    const reload = () => {
      void (async () => {
        setToxicityFilterLevel(await fetchToxicityFilterLevel(supabase, userId));
        setToxicityOverThresholdBehavior(
          await fetchToxicityOverThresholdBehavior(supabase, userId)
        );
        await fetchPostsRef.current({ quiet: true });
      })();
    };
    window.addEventListener(VIEWER_TOXICITY_UPDATED_EVENT, reload);
    return () =>
      window.removeEventListener(VIEWER_TOXICITY_UPDATED_EVENT, reload);
  }, [userId]);

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
    // postScoresById / replyScoresById は本文に出てこないが、更新時に localStorage の
    // second-moderation キューが空になったか再評価してポーリング停止させるために必要
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPendingContent, postScoresById, replyScoresById]);

  useEffect(() => {
    if (!authReady) return;
    if (!shouldPollTimeline) return;
    const id = window.setInterval(() => {
      void fetchPostsRef.current({ quiet: true });
    }, 30000);
    return () => window.clearInterval(id);
  }, [authReady, shouldPollTimeline]);

  useEffect(() => {
    const node = timelineLoadMoreSentinelRef.current;
    if (!node) return;
    if (timelineLoading || timelineLoadingMore || !timelineHasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        if (timelineLoading || timelineLoadingMore || !timelineHasMore) return;
        void fetchPostsRef.current({ append: true });
      },
      { root: null, rootMargin: "240px 0px", threshold: 0.01 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [timelineLoading, timelineLoadingMore, timelineHasMore, posts.length]);

  /** pending が消えた直後（cron 確定直後）に即再取得し、2行目取得 effect が確定本文を見られるようにする */
  const hadPendingContentRef = useRef(false);
  useEffect(() => {
    if (!authReady) return;
    if (hadPendingContentRef.current && !hasPendingContent) {
      const needSecond =
        loadPostIdsPendingSecondModeration().length > 0 ||
        loadReplyIdsPendingSecondModeration().length > 0;
      if (needSecond) void fetchPostsRef.current({ quiet: true });
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
          !isPastInitialEditWindow(post.created_at)
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
          !isPastInitialEditWindow(reply.created_at)
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
    expiryTick,
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
      // On tab refocus, some environments can emit transient null sessions.
      // Ignore them to avoid resetting profile/timeline state unnecessarily.
      if (!session?.user) return;
      setUserIfChanged(session.user);
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
      loadedProfileUserIdRef.current = null;
      startTransition(() => {
        setProfileReady(false);
        setProfileNickname(null);
        setMustChangePassword(false);
        setInviteLabel(null);
        setInviteOnboardingCompleted(true);
      });
      return;
    }

    if (loadedProfileUserIdRef.current === userId && profileReady) {
      return;
    }

    startTransition(() => {
      setProfileReady(false);
    });

    void (async () => {
      await ensurePublicUserRow(user);
      const { data, error } = await supabase
        .from("users")
        .select(
          "nickname, avatar_url, avatar_placeholder_hex, must_change_password, invite_label, invite_onboarding_completed, public_id"
        )
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        setErrorMessage(error.message);
        setProfileReady(true);
        return;
      }

      const nick = data?.nickname ?? null;
      setMustChangePassword(Boolean(data?.must_change_password));
      setInviteLabel(
        typeof data?.invite_label === "string" ? data.invite_label : null
      );
      setInviteOnboardingCompleted(
        Boolean(
          (data as { invite_onboarding_completed?: boolean } | null)
            ?.invite_onboarding_completed
        )
      );
      setProfileNickname(nick);
      setProfileAvatarUrl(data?.avatar_url ?? null);
      setProfilePlaceholderHex(
        (data as { avatar_placeholder_hex?: string | null } | null)
          ?.avatar_placeholder_hex ?? null
      );
      setToxicityFilterLevel(await fetchToxicityFilterLevel(supabase, userId));
      setToxicityOverThresholdBehavior(
        await fetchToxicityOverThresholdBehavior(supabase, userId)
      );
      loadedProfileUserIdRef.current = userId;
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
    // fetchPosts は毎レンダー再生成のため依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, userId, profileReady]);

  useEffect(() => {
    if (
      !userId ||
      !profileReady ||
      needsNickname ||
      needsPasswordChange ||
      needsInviteOnboarding
    ) {
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
  }, [
    userId,
    profileReady,
    needsNickname,
    needsPasswordChange,
    needsInviteOnboarding,
  ]);

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
    setMustChangePassword(false);
    setInviteLabel(null);
    setInviteOnboardingCompleted(true);
    setProfileReady(false);
    setToxicityFilterLevel(DEFAULT_TOXICITY_FILTER_LEVEL);
    setToxicityOverThresholdBehavior(DEFAULT_TOXICITY_OVER_THRESHOLD_BEHAVIOR);
    void fetchPosts({ quiet: true });
  };

  const handleReplySubmit = async (postId: number) => {
    if (!userId) {
      setErrorMessage("ログインしてください。");
      return;
    }
    if (needsNickname || needsPasswordChange || needsInviteOnboarding)
      return;
    const content = (replyDrafts[postId] ?? "").trim();
    if (!content) {
      setToast({ message: "返信を入力してください。", tone: "error" });
      return;
    }
    if (content.length > POST_AND_REPLY_MAX_CHARS) {
      setToast({
        message: `返信は${POST_AND_REPLY_MAX_CHARS}文字以内にしてください。`,
        tone: "error",
      });
      return;
    }
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
      setReplyComposerPostId(null);
      if (overallMax >= HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD) {
        setToast({
          message: REPLY_HIGH_TOXICITY_VISIBILITY_NOTICE,
          tone: "default",
        });
      }
      await fetchPosts({ quiet: true });
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
    await fetchPosts({ quiet: true });
  };

  const toggleReplyPanel = (postId: number) => {
    setOpenedReplyPosts((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };

  const handleSaveReplyEdit = async (replyId: number) => {
    if (!userId) return;
    const content = editReplyDraft.trim();
    if (!content) {
      setToast({
        message: "本文を入力してください。",
        tone: "error",
      });
      return;
    }
    if (content.length > POST_AND_REPLY_MAX_CHARS) {
      setToast({
        message: `返信は${POST_AND_REPLY_MAX_CHARS}文字以内にしてください。`,
        tone: "error",
      });
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
      setToast({ message: error.message, tone: "error" });
      return;
    }
    setEditingReplyId(null);
    markReplyNeedsSecondModeration(replyId);
    setToast({
      message: "編集を保存しました。15分後に反映されます。",
      tone: "default",
    });
    await fetchPosts({ quiet: true });
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
    await fetchPosts({ quiet: true });
  };

  const handleSavePostEdit = async (postId: number) => {
    if (postEditSaving) return;
    if (!userId) {
      setToast({ message: "ログインしてください。", tone: "error" });
      return;
    }
    const content = editDraft.trim();
    const existing = posts.find((p) => p.id === postId);
    const hasImage = Boolean(existing?.image_storage_path?.trim());
    if (!content) {
      setToast({
        message: hasImage
          ? "投稿には本文が必要です"
          : "本文を入力してください。",
        tone: "error",
      });
      return;
    }
    if (content.length > POST_AND_REPLY_MAX_CHARS) {
      setToast({
        message: `投稿は${POST_AND_REPLY_MAX_CHARS}文字以内にしてください。`,
        tone: "error",
      });
      return;
    }
    setPostEditSaving(true);
    setErrorMessage(null);
    let error: { message: string } | null = null;
    try {
      const res = await supabase
        .from("posts")
        .update({ pending_content: content })
        .eq("id", postId)
        .eq("user_id", userId);
      error = res.error;
    } catch {
      setPostEditSaving(false);
      setToast({
        message: "通信エラーが発生しました。もう一度お試しください。",
        tone: "error",
      });
      return;
    }
    setPostEditSaving(false);
    if (error) {
      setToast({ message: error.message, tone: "error" });
      return;
    }
    setEditingPostId(null);
    markPostNeedsSecondModeration(postId);
    setToast({
      message: "編集を保存しました。15分後に反映されます。",
      tone: "default",
    });
    await fetchPosts({ quiet: true });
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId) {
      return;
    }
    if (needsNickname || needsPasswordChange || needsInviteOnboarding)
      return;
    const textContent = input.trim();
    if (!textContent && !composePostImage) {
      setToast({ message: "投稿内容を入力してください。", tone: "error" });
      return;
    }
    if (!textContent && composePostImage) {
      const msg = "画像を添付する場合は本文を入力してください。";
      setToast({ message: msg, tone: "error" });
      return;
    }
    if (textContent.length > POST_AND_REPLY_MAX_CHARS) {
      const msg = `投稿は${POST_AND_REPLY_MAX_CHARS}文字以内にしてください。`;
      setToast({ message: msg, tone: "error" });
      return;
    }

    setPostSubmitting(true);

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
        setPostSubmitting(false);
        return;
      }
    }

    const { data: sessionWrap, error: sessionReadErr } =
      await supabase.auth.getSession();
    if (sessionReadErr) {
      console.error("getSession error:", sessionReadErr);
    }
    const sessionUser = sessionWrap.session?.user;
    if (!sessionUser?.id) {
      setPostSubmitting(false);
      return;
    }
    const authorId = sessionUser.id;
    if (authorId !== userId) {
      setUser(sessionUser);
    }

    const { data, error } = await supabase
      .from("posts")
      .insert({
        content: textContent,
        user_id: authorId,
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
        authorId,
        data.id,
        composePostImage
      );
      if (!up.ok) {
        await supabase.from("posts").delete().eq("id", data.id);
        setPostSubmitting(false);
        return;
      }
      const { error: updErr } = await supabase
        .from("posts")
        .update({ image_storage_path: up.path })
        .eq("id", data.id)
        .eq("user_id", authorId);
      if (updErr) {
        await removePostImageIfAny(supabase, up.path);
        await supabase.from("posts").delete().eq("id", data.id);
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
      setToast({
        message: POST_HIGH_TOXICITY_VISIBILITY_NOTICE,
        tone: "default",
      });
    }
    await fetchPosts({ quiet: true });
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
    // 一覧を再 fetch しない（スクロールが先頭に戻るのを防ぐ）。アンスキと同様。
  };

  /**
   * ReplyThread / ReplyItem に渡す安定コールバック群。
   * 最新実体は ref 経由で差し替え、外に渡す参照は固定化して React.memo を効かせる。
   */
  const handleDeleteReplyRef = useRef(handleDeleteReply);
  handleDeleteReplyRef.current = handleDeleteReply;
  const handleSaveReplyEditRef = useRef(handleSaveReplyEdit);
  handleSaveReplyEditRef.current = handleSaveReplyEdit;
  const stableOnDeleteReply = useCallback((rid: number) => {
    void handleDeleteReplyRef.current(rid);
  }, []);
  const stableOnSaveReplyEdit = useCallback((rid: number) => {
    void handleSaveReplyEditRef.current(rid);
  }, []);
  const stableOnStartEditReply = useCallback(
    (r: { id: number; content: string; pending_content?: string | null }) => {
      setEditingReplyId(r.id);
      setEditReplyDraft(r.pending_content ?? r.content);
    },
    []
  );
  const stableOnCancelEditReply = useCallback(() => {
    setEditingReplyId(null);
  }, []);
  // 非ログイン/プロフィール未確定時に返信「スキ」が silent に
  // トグルされていたため、投稿側と同じ tryInteraction ゲートを通す。
  // useCallback は deps=[] で維持したいので ref 経由で最新の
  // tryInteraction を参照する。
  const tryInteractionRef = useRef<() => boolean>(() => false);
  const stableOnToggleLikeReply = useCallback((replyId: number) => {
    if (!tryInteractionRef.current()) return;
    setLikedReplyIds((prev) => {
      const next = new Set(prev);
      if (next.has(replyId)) next.delete(replyId);
      else next.add(replyId);
      return next;
    });
  }, []);
  const stableOnReplyBubble = useCallback(
    (r: { id: number; post_id: number }) => {
      setInlineReplyPostId(r.post_id);
      setReplyParentReplyId(r.id);
    },
    []
  );
  const stableOnEditDraftChange = useCallback((v: string) => {
    setEditReplyDraft(v);
  }, []);

  const partitionByPost = useMemo(() => {
    const map: Record<
      number,
      { roots: PostReply[]; childrenByParent: Record<number, PostReply[]> }
    > = {};
    for (const [pidStr, list] of Object.entries(repliesByPost)) {
      if (!list || list.length === 0) continue;
      map[Number(pidStr)] = partitionRepliesByParent(list);
    }
    return map;
  }, [repliesByPost]);

  const canInteract =
    Boolean(userId) &&
    profileReady &&
    !needsNickname &&
    !needsPasswordChange &&
    !needsInviteOnboarding;

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
    if (needsNickname || needsPasswordChange || needsInviteOnboarding)
      return false;
    const msg = interactionBlockedMessage();
    if (msg) {
      setAuthGateModal({ open: true, message: msg });
      return false;
    }
    return true;
  };
  // stableOnToggleLikeReply（deps=[] のため stale closure になる）から
  // 最新の tryInteraction を呼べるようにレンダーごとに ref を更新する。
  tryInteractionRef.current = tryInteraction;

  const replyModalContext = useMemo(() => {
    // expiryTick を deps に含めることで、編集窓が切れた瞬間に
    // resolvePendingVisibleContent() の結果（pending_content のプレビュー切替）を
    // 再評価する。値自体は参照しないので void で lint を満たす。
    void expiryTick;
    const pid = replyComposerPostId;
    if (pid == null) return null;
    const post = posts.find((p) => p.id === pid);
    if (!post) return null;
    const flat = repliesByPost[pid] ?? [];
    const prid = replyParentReplyId;
    const clip = (t: string) => {
      const s = t.replace(/\s+/g, " ").trim();
      return s.length > 280 ? `${s.slice(0, 280)}…` : s;
    };
    if (prid != null) {
      const r = flat.find((x) => x.id === prid);
      if (!r) return null;
      const text = resolvePendingVisibleContent(
        r.content,
        r.pending_content,
        r.created_at
      );
      return {
        targetNickname: r.users?.nickname ?? null,
        targetAvatarUrl: r.users?.avatar_url ?? null,
        targetPlaceholderHex: r.users?.avatar_placeholder_hex ?? null,
        targetPreview: clip(text),
      };
    }
    const text = resolvePendingVisibleContent(
      post.content,
      post.pending_content,
      post.created_at
    );
    return {
      targetNickname: post.users?.nickname ?? null,
      targetAvatarUrl: post.users?.avatar_url ?? null,
      targetPlaceholderHex: post.users?.avatar_placeholder_hex ?? null,
      targetPreview: clip(text),
    };
  }, [replyComposerPostId, replyParentReplyId, posts, repliesByPost, expiryTick]);

  useEffect(() => {
    if (replyComposerPostId == null) return;
    if (replyModalContext == null) {
      setReplyComposerPostId(null);
      setReplyParentReplyId(null);
    }
  }, [replyComposerPostId, replyModalContext]);

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
        {authReady && (!(userId && !profileReady) || posts.length > 0) ? (
          <>
            {canInteract && composeOpen ? (
              <div className="touch-manipulation fixed inset-x-4 bottom-20 z-[55] md:inset-x-auto md:right-6 md:w-[34rem]">
                <form
                  onSubmit={handleSubmit}
                  className="touch-manipulation flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
                >
                  <div className="flex items-end gap-2">
                    <AutosizeTextarea
                      ref={composeTextareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="いまどうしてる？"
                      maxRows={12}
                      maxLength={POST_AND_REPLY_MAX_CHARS}
                      disabled={postSubmitting}
                      autoComplete="off"
                      enterKeyHint="send"
                      className="min-h-[2.75rem] min-w-0 flex-1 resize-none overflow-hidden rounded-2xl border border-gray-300 bg-white px-3 py-2 text-base leading-snug outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
                    />
                    <ImageAttachIconButton
                      disabled={postSubmitting}
                      onPick={(file) => {
                        void (async () => {
                          const r = await preparePostImageForUpload(file);
                          if (!r.ok) {
                            return;
                          }
                          setComposePostImage({
                            blob: r.blob,
                            contentType: r.contentType,
                            ext: r.ext,
                          });
                        })();
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
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
              {timelineLoading ? (
                <p className="text-sm text-gray-500">投稿を読み込み中…</p>
              ) : posts.length === 0 ? (
                <p className="text-sm text-gray-500">
                  まだ投稿がありません。
                </p>
              ) : (
                <>
                <ul className="space-y-3">
                  {posts.map((post) => {
                  const name = displayName(
                    post.users?.nickname,
                    post.users?.public_id
                  );
                  return (
                <li
                  key={post.id}
                  className="break-words rounded-lg border border-gray-200 bg-white p-4"
                >
                  <div className="mb-1 flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {post.user_id ? (
                        post.users?.public_id ? (
                        <Link
                          href={`/@${post.users.public_id}`}
                          className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-800 hover:text-blue-800"
                        >
                          <UserAvatar
                            name={name}
                            avatarUrl={post.users?.avatar_url ?? null}
                            placeholderHex={
                              post.users?.avatar_placeholder_hex ?? null
                            }
                          />
                          <span className="line-clamp-2 min-w-0 flex-1 break-words underline decoration-blue-200 underline-offset-2">
                            {name}
                          </span>
                        </Link>
                        ) : (
                        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-800">
                          <UserAvatar
                            name={name}
                            avatarUrl={post.users?.avatar_url ?? null}
                            placeholderHex={
                              post.users?.avatar_placeholder_hex ?? null
                            }
                          />
                          <span className="line-clamp-2 min-w-0 flex-1 break-words">
                            {name}
                          </span>
                        </div>
                        )
                      ) : (
                        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-800">
                          <UserAvatar
                            name={name}
                            avatarUrl={post.users?.avatar_url ?? null}
                            placeholderHex={
                              post.users?.avatar_placeholder_hex ?? null
                            }
                          />
                          <span className="line-clamp-2 min-w-0 flex-1 break-words">
                            {name}
                          </span>
                        </div>
                      )}
                    </div>
                    {canInteract &&
                    userId &&
                    post.user_id &&
                    post.user_id === userId ? (
                      <button
                        type="button"
                        onClick={() =>
                          void handleDeletePost(
                            post.id,
                            post.image_storage_path
                          )
                        }
                        className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-700 hover:bg-red-100"
                      >
                        削除
                      </button>
                    ) : null}
                  </div>
                  <div className="mb-1 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm text-gray-500">
                    <span className="min-w-0">
                      {post.created_at
                        ? new Date(post.created_at).toLocaleString()
                        : ""}
                    </span>
                    {canInteract &&
                    userId &&
                    post.user_id &&
                    post.user_id === userId &&
                    canEditOwnPost(post.created_at, userId, post.user_id) ? (
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        {/*
                          「編集残り MM:SS」の常時表示は廃止。編集フォームを開いた
                          時だけ下の EditCountdownBadge で表示する。
                          詳細は home/page.tsx の同等ブロックのコメント参照。
                        */}
                        {editingPostId === post.id ? (
                          <button
                            type="button"
                            onClick={() => setEditingPostId(null)}
                            className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-800 hover:bg-gray-50"
                          >
                            編集取消
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPostId(post.id);
                              setEditDraft(
                                post.pending_content ?? post.content
                              );
                            }}
                            className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-800 hover:bg-gray-50"
                          >
                            編集
                          </button>
                        )}
                      </div>
                    ) : null}
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
                  {(() => {
                    const postScore = effectiveScoreForViewerToxicityFilter(
                      post.moderation_max_score
                    );
                    const postThreshold = userId
                      ? thresholdForLevel(toxicityFilterLevel)
                      : ANON_TOXICITY_VIEW_THRESHOLD;
                    const isOwnPost = Boolean(userId && post.user_id === userId);
                    const shouldFoldPost =
                      toxicityOverThresholdBehavior === "fold" &&
                      !isOwnPost &&
                      postScore > postThreshold &&
                      !expandedFoldedPosts.has(post.id);
                    if (shouldFoldPost) {
                      return (
                        <div className="mt-2 rounded-md border border-amber-100 bg-amber-50/60 px-3 py-2 text-sm text-amber-950">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedFoldedPosts((prev) => {
                                const next = new Set(prev);
                                next.add(post.id);
                                return next;
                              })
                            }
                            className="text-left text-sm font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
                          >
                            表示制限中（タップで展開）
                          </button>
                        </div>
                      );
                    }
                    return editingPostId === post.id ? (
                    <div className="mt-1 space-y-2">
                      <AutosizeTextarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        maxRows={14}
                        maxLength={POST_AND_REPLY_MAX_CHARS}
                        disabled={postEditSaving}
                        className="min-h-[2.75rem] w-full resize-none overflow-hidden rounded-2xl border border-gray-300 bg-white px-3 py-2 text-sm leading-snug outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:opacity-50"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={postEditSaving}
                          onClick={() => void handleSavePostEdit(post.id)}
                          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {postEditSaving ? "保存中…" : "保存"}
                        </button>
                        <EditCountdownBadge createdAt={post.created_at} />
                      </div>
                    </div>
                    ) : (
                    <div className="mt-1 whitespace-pre-wrap break-words">
                      {renderTextWithLinks(
                        resolvePendingVisibleContent(
                          post.content,
                          post.pending_content,
                          post.created_at
                        )
                      )}
                    </div>
                    );
                  })()}
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
                        const opened = openedReplyPosts.has(post.id);
                        if (!opened) {
                          toggleReplyPanel(post.id);
                          setInlineReplyPostId(post.id);
                          setReplyParentReplyId(null);
                          return;
                        }
                        setInlineReplyPostId(post.id);
                        setReplyParentReplyId(null);
                      }}
                      className={[
                        "inline-flex items-center justify-center rounded-md border p-2 hover:opacity-90",
                        (repliesByPost[post.id]?.length ?? 0) > 0
                          ? "border-sky-300 bg-sky-100 text-sky-800"
                          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
                      ].join(" ")}
                      aria-label="返信"
                      title="返信"
                    >
                      <ReplyBubbleIcon
                        className={
                          (repliesByPost[post.id]?.length ?? 0) > 0
                            ? "text-sky-700"
                            : "text-gray-600"
                        }
                      />
                    </button>
                  </div>
                    {openedReplyPosts.has(post.id) ? (
                    <div className="mt-3 border-t border-gray-100 pt-3 text-sm">
                      {(() => {
                        const parted = partitionByPost[post.id];
                        if (!parted) return null;
                        return (
                          <ReplyThread
                            roots={parted.roots}
                            childrenByParent={parted.childrenByParent}
                            userId={userId}
                            canInteract={canInteract}
                            editingReplyId={editingReplyId}
                            editReplyDraft={editReplyDraft}
                            replyEditSaving={replyEditSaving}
                            replyVisibilityThreshold={
                              userId
                                ? thresholdForLevel(toxicityFilterLevel)
                                : ANON_TOXICITY_VIEW_THRESHOLD
                            }
                            overThresholdBehavior={toxicityOverThresholdBehavior}
                            replyScoresById={replyScoresById}
                            onEditDraftChange={stableOnEditDraftChange}
                            onStartEdit={stableOnStartEditReply}
                            onCancelEdit={stableOnCancelEditReply}
                            onSaveEdit={stableOnSaveReplyEdit}
                            onDelete={stableOnDeleteReply}
                              likedReplyIds={likedReplyIds}
                              onToggleLikeReply={stableOnToggleLikeReply}
                              activeReplyTargetId={
                                replyComposerPostId === post.id
                                  ? replyParentReplyId
                                  : null
                              }
                              onReplyBubble={stableOnReplyBubble}
                          />
                        );
                      })()}
                    </div>
                  ) : null}
                </li>
                  );
                })}
                </ul>
                <div ref={timelineLoadMoreSentinelRef} className="h-1 w-full" />
                {timelineLoadingMore ? (
                  <p className="mt-4 text-center text-sm text-gray-500">
                    読み込み中…
                  </p>
                ) : timelineHasMore ? (
                  <div className="mt-4 flex justify-center">
                    <button
                      type="button"
                      onClick={() => void fetchPostsRef.current({ append: true })}
                      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      さらに読み込む
                    </button>
                  </div>
                ) : null}
                </>
              )}
            </section>
          </>
        ) : null}

        {userId && !profileReady && posts.length === 0 ? (
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

      {canInteract && inlineReplyPostId != null ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!tryInteraction()) return;
            void handleReplySubmit(inlineReplyPostId);
          }}
          className="fixed inset-x-2 bottom-16 z-[56] flex items-end gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-lg"
        >
          <UserAvatar
            name={profileNickname}
            avatarUrl={profileAvatarUrl}
            placeholderHex={profilePlaceholderHex}
            size="sm"
          />
          <AutosizeTextarea
            value={replyDrafts[inlineReplyPostId] ?? ""}
            onChange={(e) =>
              setReplyDrafts((prev) => ({
                ...prev,
                [inlineReplyPostId]: e.target.value,
              }))
            }
            placeholder={(() => {
              const post = posts.find((p) => p.id === inlineReplyPostId);
              const targetReply =
                replyParentReplyId != null
                  ? (repliesByPost[inlineReplyPostId] ?? []).find(
                      (r) => r.id === replyParentReplyId
                    )
                  : null;
              const n = targetReply
                ? displayName(
                    targetReply.users?.nickname,
                    targetReply.users?.public_id
                  )
                : displayName(post?.users?.nickname, post?.users?.public_id);
              const pid =
                targetReply?.users?.public_id ??
                post?.users?.public_id ??
                "ID未設定";
              return `${n}（${pid}）に返信`;
            })()}
            maxRows={4}
            maxLength={POST_AND_REPLY_MAX_CHARS}
            disabled={replySubmittingPostId === inlineReplyPostId}
            className="min-h-[2.2rem] min-w-0 flex-1 resize-none overflow-hidden rounded-2xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
          />
          {(replyDrafts[inlineReplyPostId] ?? "").trim().length > 0 ? (
            <button
              type="submit"
              disabled={replySubmittingPostId === inlineReplyPostId}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              aria-label="送信"
              title="送信"
            >
              ↑
            </button>
          ) : null}
        </form>
      ) : null}

      <MustChangePasswordModal
        open={Boolean(userId && profileReady && needsPasswordChange)}
        userId={userId}
        inviteLabel={inviteLabel}
        onCompleted={() => {
          setMustChangePassword(false);
        }}
      />

      {toast?.message?.trim() ? (
        <AppToastPortal message={toast.message} tone={toast.tone} />
      ) : null}

    </main>
  );
}
