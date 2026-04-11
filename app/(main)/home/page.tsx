"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PostgrestError, User } from "@supabase/supabase-js";
import { AutosizeTextarea } from "@/components/autosize-textarea";
import { ImageAttachIconButton } from "@/components/image-attach-icon-button";
import { MustChangePasswordModal } from "@/components/must-change-password-modal";
import { NicknameRequiredModal } from "@/components/nickname-required-modal";
import {
  ReplyComposerModal,
  ReplyBubbleIcon,
} from "@/components/reply-composer-modal";
import { ReplyThread } from "@/components/reply-thread";
import { SiteHeader } from "@/components/site-header";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";
import { pickAvatarPlaceholderHex } from "@/lib/avatar-placeholder";
import {
  fetchToxicityFilterLevel,
  fetchToxicityOverThresholdBehavior,
} from "@/lib/timeline-threshold";
import {
  POST_HIGH_TOXICITY_VISIBILITY_NOTICE,
  REPLY_HIGH_TOXICITY_VISIBILITY_NOTICE,
} from "@/lib/visibility-notice";
import {
  DEFAULT_TOXICITY_FILTER_LEVEL,
  DEFAULT_TOXICITY_OVER_THRESHOLD_BEHAVIOR,
  HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD,
  thresholdForLevel,
  type ToxicityOverThresholdBehavior,
  type ToxicityFilterLevel,
} from "@/lib/toxicity-filter-level";
import { isMissingAvatarPlaceholderHexError } from "@/lib/users-update-fallback";
import {
  filterPresetRows,
  MAX_CUSTOM_INTEREST_LEN,
  MAX_CUSTOM_INTEREST_REGISTRATIONS,
  MAX_INTEREST_TAGS,
  type InterestPick,
  normalizeInterestInput,
  validateInterestLabelForRegistration,
} from "@/lib/interests";
import {
  POST_AND_REPLY_MAX_CHARS,
  PROFILE_BIO_MAX_CHARS,
} from "@/lib/compose-text-limits";
import { validateNickname } from "@/lib/nickname";
import { COMPOSE_OPEN_EVENT } from "@/components/compose-open-bus";
import { requestOpenSettings } from "@/components/settings-open-bus";
import { AppToastPortal } from "@/components/app-toast-portal";
import { VIEWER_TOXICITY_UPDATED_EVENT } from "@/components/viewer-toxicity-bus";
import { sanitizeExternalProfileUrl } from "@/lib/sanitize-external-url";
import {
  canEditOwnPost,
  formatRemainingLabel,
  getEditRemainingMs,
  resolvePendingVisibleContent,
} from "@/lib/post-edit-window";
import { ModerationCompactRow } from "@/components/moderation-compact-row";
import { partitionRepliesByParent } from "@/lib/reply-tree";
import {
  getPostImagePublicUrl,
  preparePostImageForUpload,
  removePostImageIfAny,
  uploadPostImage,
  type PreparedPostImage,
} from "@/lib/post-image-storage";
import { normalizePerspectiveScores } from "@/lib/perspective-labels";
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
const RELATION_PENALTY_MIN_SCORE = 0.2;

type Post = {
  id: number;
  content: string;
  pending_content?: string | null;
  created_at?: string;
  user_id?: string;
  moderation_max_score?: number;
  moderation_dev_scores?: unknown;
  image_storage_path?: string | null;
  users?: {
    nickname: string | null;
    avatar_url?: string | null;
    avatar_placeholder_hex?: string | null;
  } | null;
};

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

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [profileNickname, setProfileNickname] = useState<string | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profilePlaceholderHex, setProfilePlaceholderHex] = useState<
    string | null
  >(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [inviteLabel, setInviteLabel] = useState<string | null>(null);
  const [inviteOnboardingCompleted, setInviteOnboardingCompleted] =
    useState(true);
  const [nicknameLocked, setNicknameLocked] = useState(false);
  const [profileExternalUrl, setProfileExternalUrl] = useState("");
  const [externalUrlDraft, setExternalUrlDraft] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [toxicityFilterLevel, setToxicityFilterLevel] =
    useState<ToxicityFilterLevel>(DEFAULT_TOXICITY_FILTER_LEVEL);
  const [toxicityOverThresholdBehavior, setToxicityOverThresholdBehavior] =
    useState<ToxicityOverThresholdBehavior>(
      DEFAULT_TOXICITY_OVER_THRESHOLD_BEHAVIOR
    );
  const [postScoresById, setPostScoresById] = useState(() =>
    loadDevScoresFromLocalStorage(POST_DEV_SCORES_KEY)
  );
  const [replyScoresById, setReplyScoresById] = useState(() =>
    loadDevScoresFromLocalStorage(REPLY_DEV_SCORES_KEY)
  );
  const [scoresPersistenceEnabled, setScoresPersistenceEnabled] =
    useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [presetRows, setPresetRows] = useState<InterestPick[]>([]);
  const [interestPicksServer, setInterestPicksServer] = useState<
    InterestPick[]
  >([]);
  const [interestDraft, setInterestDraft] = useState<InterestPick[]>([]);
  const [customCreationsUsed, setCustomCreationsUsed] = useState(0);
  const [interestSearchQuery, setInterestSearchQuery] = useState("");
  const [interestConfirm, setInterestConfirm] = useState<{
    label: string;
    insertsRemaining: number;
  } | null>(null);
  const [interestPickerOpen, setInterestPickerOpen] = useState(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  type ToastState = { message: string; tone: "default" | "error" };
  const [toast, setToast] = useState<ToastState | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
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
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeFormError, setComposeFormError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [composePostImage, setComposePostImage] =
    useState<PreparedPostImage | null>(null);
  const [composeImagePreviewUrl, setComposeImagePreviewUrl] = useState<
    string | null
  >(null);
  const composeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [moderationMode, setModerationMode] = useState<"mock" | "perspective">(
    "perspective"
  );
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
  const [replyComposerPostId, setReplyComposerPostId] = useState<number | null>(
    null
  );
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [interestPlusPending, setInterestPlusPending] = useState(false);
  const profileEditOpenRef = useRef(false);
  const postScoresByIdRef = useRef(postScoresById);
  const replyScoresByIdRef = useRef(replyScoresById);
  const secondModerationBusyRef = useRef<Set<string>>(new Set());
  postScoresByIdRef.current = postScoresById;
  replyScoresByIdRef.current = replyScoresById;

  const userId = user?.id ?? null;
  const needsPasswordChange =
    Boolean(userId) && profileReady && mustChangePassword;
  const needsInviteOnboarding =
    Boolean(userId) && profileReady && !inviteOnboardingCompleted;
  const needsNickname =
    Boolean(userId) &&
    profileReady &&
    !needsPasswordChange &&
    !needsInviteOnboarding &&
    profileNickname === null;

  useEffect(() => {
    if (!needsNickname) setNicknameModalError(null);
  }, [needsNickname]);

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

  const joinedAtLabel =
    user?.created_at != null
      ? new Date(user.created_at).toLocaleDateString("ja-JP")
      : null;

  async function ensurePublicUserRow(u: User) {
    const { error } = await supabase.from("users").upsert(
      {
        id: u.id,
        email: u.email ?? "",
      },
      { onConflict: "id" }
    );
    if (error) console.warn("ensurePublicUserRow:", error.message);
  }

  const fetchOwnPosts = async (uid: string) => {
    try {
      await fetch("/api/finalize-my-pending", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      /* 確定 API が失敗しても一覧取得は続行 */
    }
    const { data: rows, error } = await supabase
      .from("posts")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const profileRes = await supabase
      .from("users")
      .select(
        "nickname, avatar_url, avatar_placeholder_hex, bio, interest_custom_creations_count, must_change_password, invite_label, invite_onboarding_completed, nickname_locked, profile_external_url"
      )
      .eq("id", uid)
      .maybeSingle();

    type ProfileRow = {
      nickname: string | null;
      avatar_url: string | null;
      avatar_placeholder_hex?: string | null;
      bio: string | null;
      interest_custom_creations_count?: number | null;
      must_change_password?: boolean | null;
      invite_label?: string | null;
      invite_onboarding_completed?: boolean | null;
      nickname_locked?: boolean | null;
      profile_external_url?: string | null;
    };

    let profile: ProfileRow | null = profileRes.data as ProfileRow | null;
    if (profileRes.error) {
      const fallback = await supabase
        .from("users")
        .select(
          "nickname, avatar_url, avatar_placeholder_hex, bio, must_change_password, invite_label, invite_onboarding_completed, nickname_locked, profile_external_url"
        )
        .eq("id", uid)
        .maybeSingle();
      if (fallback.error) {
        setErrorMessage(fallback.error.message);
        return;
      }
      profile = fallback.data as ProfileRow | null;
    }

    const [filterLevel, overBehavior] = await Promise.all([
      fetchToxicityFilterLevel(supabase, uid),
      fetchToxicityOverThresholdBehavior(supabase, uid),
    ]);

    // プリセットだけでなく、誰かが登録した is_preset=false も共有マスタなので検索対象に含める
    const catalogRes = await supabase
      .from("interest_tags")
      .select("id, label")
      .order("label");

    const catalogData = catalogRes.data;
    const catalogWarning = catalogRes.error
      ? `${catalogRes.error.message}（interest_tags 未適用の可能性。趣味・関心の一覧が使えません。）`
      : null;

    const uiRes = await supabase
      .from("user_interests")
      .select("position, tag_id, interest_tags ( label )")
      .eq("user_id", uid)
      .order("position", { ascending: true });

    const uiWarning = uiRes.error
      ? `${uiRes.error.message}（user_interests 未適用の可能性。趣味・関心は空表示になります。）`
      : null;

    const picks: InterestPick[] = (uiRes.data ?? []).map((row) => {
      const rel = row.interest_tags as
        | { label: string }
        | { label: string }[]
        | null
        | undefined;
      const label = Array.isArray(rel) ? rel[0]?.label : rel?.label;
      return {
        id: String(row.tag_id),
        label: label ?? "",
      };
    }).filter((p) => p.label);

    const creations =
      typeof profile?.interest_custom_creations_count === "number"
        ? profile.interest_custom_creations_count
        : 0;

    const nickname = profile?.nickname ?? null;
    const avatarUrl = profile?.avatar_url ?? null;
    const placeholderHex = profile?.avatar_placeholder_hex ?? null;
    const bio = profile?.bio ?? "";
    const merged = ((rows ?? []) as Post[]).map((p) => ({
      ...p,
      users: {
        nickname,
        avatar_url: avatarUrl,
        avatar_placeholder_hex: placeholderHex,
      },
    }));

    const postIds = merged.map((p) => p.id);
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

    const postScoresFromDb = buildDevScoresByIdFromRows(merged);
    const replyScoresFromDb = buildDevScoresByIdFromRows(replyRowsFlat);
    setPostScoresById((prev) => mergeDevScoresById(prev, postScoresFromDb));
    setReplyScoresById((prev) => mergeDevScoresById(prev, replyScoresFromDb));
    for (const pid of loadPostIdsPendingSecondModeration()) {
      if (postScoresFromDb[pid]?.second) removePostNeedsSecondModeration(pid);
    }
    for (const rid of loadReplyIdsPendingSecondModeration()) {
      if (replyScoresFromDb[rid]?.second) removeReplyNeedsSecondModeration(rid);
    }

    setPosts(merged);
    setMustChangePassword(Boolean(profile?.must_change_password));
    setInviteLabel(
      typeof profile?.invite_label === "string" ? profile.invite_label : null
    );
    setInviteOnboardingCompleted(
      Boolean(profile?.invite_onboarding_completed)
    );
    setNicknameLocked(Boolean(profile?.nickname_locked));
    const extUrl =
      typeof profile?.profile_external_url === "string"
        ? profile.profile_external_url.trim()
        : "";
    setProfileExternalUrl(extUrl);
    setProfileNickname(nickname);
    setProfileAvatarUrl(avatarUrl);
    setProfilePlaceholderHex(placeholderHex);
    setProfileBio(bio);
    setToxicityFilterLevel(filterLevel);
    setToxicityOverThresholdBehavior(overBehavior);
    setPresetRows((catalogData ?? []) as InterestPick[]);
    setInterestPicksServer(picks);
    if (!profileEditOpenRef.current) {
      setInterestDraft(picks);
      setExternalUrlDraft(extUrl);
    }
    setCustomCreationsUsed(creations);
    setNicknameDraft(nickname ?? "");
    setBioDraft(
      bio.length > PROFILE_BIO_MAX_CHARS
        ? bio.slice(0, PROFILE_BIO_MAX_CHARS)
        : bio
    );

    const warn = [catalogWarning, uiWarning].filter(Boolean).join(" ");
    setErrorMessage(warn || null);
  };

  const fetchOwnPostsRef = useRef(fetchOwnPosts);
  fetchOwnPostsRef.current = fetchOwnPosts;

  useEffect(() => {
    if (!userId) return;
    const reload = () => {
      void fetchOwnPostsRef.current(userId);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPendingContent, postScoresById, replyScoresById]);

  useEffect(() => {
    if (!userId || !profileReady) return;
    if (!shouldPollTimeline) return;
    const id = window.setInterval(() => {
      void fetchOwnPostsRef.current(userId);
    }, 30000);
    return () => window.clearInterval(id);
  }, [userId, profileReady, shouldPollTimeline]);

  const hadPendingContentRef = useRef(false);
  useEffect(() => {
    if (!authReady || !userId || !profileReady) return;
    if (hadPendingContentRef.current && !hasPendingContent) {
      const needSecond =
        loadPostIdsPendingSecondModeration().length > 0 ||
        loadReplyIdsPendingSecondModeration().length > 0;
      if (needSecond) void fetchOwnPostsRef.current(userId);
    }
    hadPendingContentRef.current = hasPendingContent;
  }, [authReady, userId, profileReady, hasPendingContent]);

  useEffect(() => {
    if (posts.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("post");
    if (!raw) return;
    const id = Number(raw);
    if (!Number.isFinite(id)) return;
    const el = document.getElementById(`home-post-${id}`);
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    window.history.replaceState(null, "", "/home");
  }, [posts]);

  useEffect(() => {
    if (!authReady || !profileReady || !userId) return;
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

        if (!isPastInitialEditWindow(post.created_at, nowTick)) {
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

        if (!isPastInitialEditWindow(reply.created_at, nowTick)) {
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
    profileReady,
    userId,
    posts,
    repliesByPost,
    postScoresById,
    replyScoresById,
    nowTick,
  ]);

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
    profileEditOpenRef.current = profileEditOpen;
  }, [profileEditOpen]);

  useEffect(() => {
    if (!profileEditOpen) setInterestPickerOpen(false);
  }, [profileEditOpen]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (editingPostId != null) {
      const post = posts.find((p) => p.id === editingPostId);
      if (post && getEditRemainingMs(post.created_at, nowTick) <= 0) {
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
      if (reply && getEditRemainingMs(reply.created_at, nowTick) <= 0) {
        setEditingReplyId(null);
        setToast({
          message:
            "編集時間が終了しました。保存済みの内容は投稿から15分後に反映されます。",
          tone: "default",
        });
      }
    }
  }, [nowTick, editingPostId, editingReplyId, posts, repliesByPost]);

  useEffect(() => {
    if (!userId || !user) {
      setProfileReady(false);
      setProfileNickname(null);
      setMustChangePassword(false);
      setInviteLabel(null);
      setInviteOnboardingCompleted(true);
      setNicknameLocked(false);
      setProfileExternalUrl("");
      setExternalUrlDraft("");
      setProfilePlaceholderHex(null);
      setPosts([]);
      setRepliesByPost({});
      setReplyDrafts({});
      setReplyComposerPostId(null);
      setEditingPostId(null);
      setReplyParentReplyId(null);
      setEditingReplyId(null);
      setToxicityFilterLevel(DEFAULT_TOXICITY_FILTER_LEVEL);
      setToxicityOverThresholdBehavior(DEFAULT_TOXICITY_OVER_THRESHOLD_BEHAVIOR);
      return;
    }

    setProfileReady(false);
    void (async () => {
      await ensurePublicUserRow(user);
      await fetchOwnPosts(userId);
      setProfileReady(true);
    })();
  }, [userId, user]);

  const signOut = async () => {
    setErrorMessage(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setPosts([]);
    setProfileNickname(null);
    setProfileAvatarUrl(null);
    setProfilePlaceholderHex(null);
    setMustChangePassword(false);
    setInviteLabel(null);
    setInviteOnboardingCompleted(true);
    setNicknameLocked(false);
    setProfileExternalUrl("");
    setExternalUrlDraft("");
    setProfileBio("");
    setPresetRows([]);
    setInterestPicksServer([]);
    setInterestDraft([]);
    setCustomCreationsUsed(0);
    setNicknameDraft("");
    setBioDraft("");
    setInterestSearchQuery("");
    setInterestConfirm(null);
    setProfileEditOpen(false);
    setProfileReady(false);
    setRepliesByPost({});
    setReplyDrafts({});
    setReplyComposerPostId(null);
    setEditingPostId(null);
    setReplyParentReplyId(null);
    setEditingReplyId(null);
    setToxicityFilterLevel(DEFAULT_TOXICITY_FILTER_LEVEL);
    setToxicityOverThresholdBehavior(DEFAULT_TOXICITY_OVER_THRESHOLD_BEHAVIOR);
  };

  const handleDeletePost = async (
    postId: number,
    imageStoragePath?: string | null
  ) => {
    if (!userId) return;
    const confirmed = window.confirm("この投稿を削除しますか？");
    if (!confirmed) return;

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

    setErrorMessage(null);
    if (editingPostId === postId) setEditingPostId(null);
    await fetchOwnPosts(userId);
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
    await fetchOwnPosts(userId);
  };

  const handleReplySubmit = async (postId: number) => {
    if (!userId) return;
    if (needsNickname || needsPasswordChange || needsInviteOnboarding) return;
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

      setReplyDrafts((prev) => ({ ...prev, [postId]: "" }));
      setReplyParentReplyId(null);
      setReplyComposerPostId(null);
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
      if (overallMax >= HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD) {
        setToast({
          message: REPLY_HIGH_TOXICITY_VISIBILITY_NOTICE,
          tone: "default",
        });
      }
      await fetchOwnPosts(userId);
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
    await fetchOwnPosts(userId);
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
    await fetchOwnPosts(userId);
  };

  const canInteract =
    Boolean(userId) &&
    profileReady &&
    !needsNickname &&
    !needsPasswordChange &&
    !needsInviteOnboarding;

  const tryInteraction = (): boolean => {
    if (needsNickname || needsPasswordChange || needsInviteOnboarding)
      return false;
    if (!userId) {
      setErrorMessage("ログインしてください。");
      return false;
    }
    if (!profileReady) {
      setErrorMessage("プロフィールを読み込み中です。");
      return false;
    }
    return true;
  };

  const replyModalContext = useMemo(() => {
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
        r.created_at,
        nowTick
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
      post.created_at,
      nowTick
    );
    return {
      targetNickname: post.users?.nickname ?? null,
      targetAvatarUrl: post.users?.avatar_url ?? null,
      targetPlaceholderHex: post.users?.avatar_placeholder_hex ?? null,
      targetPreview: clip(text),
    };
  }, [replyComposerPostId, replyParentReplyId, posts, repliesByPost, nowTick]);

  useEffect(() => {
    if (replyComposerPostId == null) return;
    if (replyModalContext == null) {
      setReplyComposerPostId(null);
      setReplyParentReplyId(null);
    }
  }, [replyComposerPostId, replyModalContext]);

  const handleSubmitPost = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId) return;
    if (needsNickname || needsPasswordChange || needsInviteOnboarding) return;
    const textContent = draft.trim();
    if (!textContent && !composePostImage) {
      setComposeFormError(null);
      setToast({ message: "投稿内容を入力してください。", tone: "error" });
      return;
    }
    if (!textContent && composePostImage) {
      const msg = "画像を添付する場合は本文を入力してください。";
      setComposeFormError(msg);
      setToast({ message: msg, tone: "error" });
      return;
    }
    if (textContent.length > POST_AND_REPLY_MAX_CHARS) {
      const msg = `投稿は${POST_AND_REPLY_MAX_CHARS}文字以内にしてください。`;
      setComposeFormError(msg);
      setToast({ message: msg, tone: "error" });
      return;
    }

    setSubmitting(true);
    setComposeFormError(null);

    let postOverallMax = 0;
    let postScores: Record<string, number> = {};

    if (textContent) {
      const moderationRes = await fetch("/api/moderate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: textContent,
          mode: moderationMode,
        }),
      });
      const moderationJson = (await moderationRes.json().catch(() => null)) as
        | {
            error?: string;
            overallMax?: number;
            degraded?: boolean;
            paragraphs?: Array<{
              scores?: Record<string, unknown>;
            }>;
          }
        | null;
      if (!moderationRes.ok) {
        const msg = moderationJson?.error ?? "AI判定に失敗しました。";
        setComposeFormError(msg);
        setToast({ message: msg, tone: "error" });
        setSubmitting(false);
        return;
      }

      postScores = normalizePerspectiveScores(
        moderationJson?.paragraphs?.[0]?.scores as
          | Record<string, unknown>
          | undefined
      );
      let maxFromApi =
        typeof moderationJson?.overallMax === "number"
          ? moderationJson.overallMax
          : 0;
      if (maxFromApi === 0 && Object.keys(postScores).length > 0) {
        maxFromApi = Math.max(...Object.values(postScores));
      }
      postOverallMax = maxFromApi;
    }

    const { data: inserted, error } = await supabase
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
      .select("id")
      .single();

    if (error) {
      const msg = error.message;
      setComposeFormError(msg);
      setToast({ message: msg, tone: "error" });
      setSubmitting(false);
      return;
    }

    if (!inserted) {
      setSubmitting(false);
      return;
    }

    if (composePostImage) {
      const up = await uploadPostImage(
        supabase,
        userId,
        inserted.id,
        composePostImage
      );
      if (!up.ok) {
        await supabase.from("posts").delete().eq("id", inserted.id);
        setComposeFormError(up.message);
        setToast({ message: up.message, tone: "error" });
        setSubmitting(false);
        return;
      }
      const { error: updErr } = await supabase
        .from("posts")
        .update({ image_storage_path: up.path })
        .eq("id", inserted.id)
        .eq("user_id", userId);
      if (updErr) {
        await removePostImageIfAny(supabase, up.path);
        await supabase.from("posts").delete().eq("id", inserted.id);
        const msg = updErr.message;
        setComposeFormError(msg);
        setToast({ message: msg, tone: "error" });
        setSubmitting(false);
        return;
      }
    }

    markPostNeedsSecondModeration(inserted.id);
    if (Object.keys(postScores).length > 0) {
      setPostScoresById((prev) => ({
        ...prev,
        [inserted.id]: { first: postScores },
      }));
    }

    setComposeFormError(null);
    setDraft("");
    setComposePostImage(null);
    setComposeOpen(false);
    if (postOverallMax >= HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD) {
      setToast({
        message: POST_HIGH_TOXICITY_VISIBILITY_NOTICE,
        tone: "default",
      });
    }
    await fetchOwnPosts(userId);
    setSubmitting(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!userId) return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorMessage("画像ファイルを選択してください。");
      return;
    }
    if (file.size > 1 * 1024 * 1024) {
      setErrorMessage("画像サイズは1MB以下にしてください。");
      return;
    }

    setAvatarUploading(true);
    setErrorMessage(null);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userId}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });
    if (uploadError) {
      setErrorMessage(uploadError.message);
      setAvatarUploading(false);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(path);
    const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;

    const { error: updateError } = await supabase
      .from("users")
      .update({ avatar_url: cacheBustedUrl })
      .eq("id", userId);
    if (updateError) {
      setErrorMessage(updateError.message);
      setAvatarUploading(false);
      return;
    }

    setProfileAvatarUrl(cacheBustedUrl);
    await fetchOwnPosts(userId);
    setAvatarUploading(false);
    e.target.value = "";
  };

  const handleProfileSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId) return;

    let nicknameValue: string | undefined;
    if (!nicknameLocked) {
      const result = validateNickname(nicknameDraft);
      if (!result.ok) {
        setErrorMessage(result.message);
        return;
      }
      nicknameValue = result.value;
    }

    const urlSan = sanitizeExternalProfileUrl(externalUrlDraft);
    if (!urlSan.ok) {
      setErrorMessage(urlSan.message);
      return;
    }

    if (bioDraft.length > PROFILE_BIO_MAX_CHARS) {
      setErrorMessage(
        `自己紹介は${PROFILE_BIO_MAX_CHARS}文字以内にしてください。`
      );
      return;
    }

    setProfileSaving(true);
    setErrorMessage(null);

    const { error: delUiError } = await supabase
      .from("user_interests")
      .delete()
      .eq("user_id", userId);

    if (delUiError) {
      setErrorMessage(delUiError.message);
      setProfileSaving(false);
      return;
    }

    if (interestDraft.length > 0) {
      const insertRows = interestDraft.map((p, i) => ({
        user_id: userId,
        tag_id: p.id,
        position: i + 1,
      }));
      const { error: insUiError } = await supabase
        .from("user_interests")
        .insert(insertRows);

      if (insUiError) {
        setErrorMessage(insUiError.message);
        setProfileSaving(false);
        return;
      }
    }

    const hex =
      profilePlaceholderHex ?? pickAvatarPlaceholderHex();
    const baseUpdate: Record<string, unknown> = {
      bio: bioDraft.trim(),
      interest_custom_creations_count: customCreationsUsed,
      profile_external_url: urlSan.href || null,
    };
    if (nicknameValue != null) {
      baseUpdate.nickname = nicknameValue;
    }
    const patch = !profilePlaceholderHex
      ? { ...baseUpdate, avatar_placeholder_hex: hex }
      : baseUpdate;

    let appliedHex: string | null = !profilePlaceholderHex ? hex : null;
    let { error } = await supabase.from("users").update(patch).eq("id", userId);

    if (error && isMissingAvatarPlaceholderHexError(error) && appliedHex != null) {
      appliedHex = null;
      ({ error } = await supabase.from("users").update(baseUpdate).eq("id", userId));
    }

    if (error) {
      const pgErr = error as PostgrestError;
      if (pgErr.code === "23505") {
        setErrorMessage("そのニックネームは既に使われています。");
      } else {
        const msg = (error.message ?? "").trim();
        setErrorMessage(msg || "保存に失敗しました。");
      }
      setProfileSaving(false);
      return;
    }

    if (nicknameValue != null) {
      setProfileNickname(nicknameValue);
    }
    setProfileBio(bioDraft.trim());
    setProfileExternalUrl(urlSan.href);
    if (appliedHex) {
      setProfilePlaceholderHex(appliedHex);
    }
    await fetchOwnPosts(userId);
    setProfileSaving(false);
    setProfileEditOpen(false);
  };

  const handleNicknameRequiredSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
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
        nickname_locked: true,
      })
      .eq("id", userId);

    if (error && isMissingAvatarPlaceholderHexError(error)) {
      savedPlaceholderHex = null;
      ({ error } = await supabase
        .from("users")
        .update({ nickname: result.value, nickname_locked: true })
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
    setNicknameDraft(result.value);
    setNicknameLocked(true);
    await fetchOwnPosts(userId);
  };

  const toggleProfileEdit = () => {
    setProfileEditOpen((prev) => {
      if (!prev) {
        setInterestDraft([...interestPicksServer]);
        setInterestSearchQuery("");
        setInterestConfirm(null);
        setInterestPickerOpen(false);
        setExternalUrlDraft(profileExternalUrl);
      }
      return !prev;
    });
  };

  const addPickById = (id: string, label: string) => {
    setInterestDraft((prev) => {
      if (prev.some((p) => p.id === id)) return prev;
      if (prev.length >= MAX_INTEREST_TAGS) return prev;
      return [...prev, { id, label }];
    });
    setInterestSearchQuery("");
    setInterestConfirm(null);
  };

  const addPresetPick = (pick: InterestPick) => {
    addPickById(pick.id, pick.label);
  };

  const mergeCatalogPick = (pick: InterestPick) => {
    setPresetRows((prev) => {
      if (prev.some((p) => p.id === pick.id)) return prev;
      return [...prev, pick].sort((a, b) =>
        a.label.localeCompare(b.label, "ja")
      );
    });
  };

  const removeInterestPick = (id: string) => {
    setInterestDraft((prev) => prev.filter((p) => p.id !== id));
  };

  const draftTagIdSet = new Set(interestDraft.map((p) => p.id));

  const presetSearchHits = normalizeInterestInput(interestSearchQuery)
    ? filterPresetRows(presetRows, interestSearchQuery, draftTagIdSet)
    : [];

  const handleInterestPlusClick = async () => {
    setErrorMessage(null);
    if (!userId || interestConfirm != null || interestPlusPending) return;
    if (interestDraft.length >= MAX_INTEREST_TAGS) {
      setErrorMessage(`趣味・関心は${MAX_INTEREST_TAGS}つまでです。`);
      return;
    }
    const hits = normalizeInterestInput(interestSearchQuery)
      ? filterPresetRows(presetRows, interestSearchQuery, draftTagIdSet)
      : [];
    if (hits.length > 0) return;

    const err = validateInterestLabelForRegistration(interestSearchQuery);
    if (err) {
      setErrorMessage(err);
      return;
    }
    const value = normalizeInterestInput(interestSearchQuery);
    if (
      interestDraft.some((p) => normalizeInterestInput(p.label) === value)
    ) {
      setErrorMessage("すでに追加されています。");
      return;
    }

    setInterestPlusPending(true);
    try {
      let catalog: InterestPick[] = presetRows;
      const { data: freshRows, error: freshErr } = await supabase
        .from("interest_tags")
        .select("id, label")
        .order("label");
      if (!freshErr && freshRows && freshRows.length > 0) {
        catalog = freshRows as InterestPick[];
        setPresetRows(catalog);
      }
      const hitsFresh = filterPresetRows(
        catalog,
        interestSearchQuery,
        draftTagIdSet
      );
      // いま取り直した一覧で候補が付いた＝DB にはもうその語がある。
      // モーダルも新規登録(INSERT)もせず、下に出るリストから選ぶだけで終了。
      if (hitsFresh.length > 0) {
        return;
      }

      const { data: existingId, error: rpcErr } = await supabase.rpc(
        "interest_tag_id_by_normalized_label",
        { p_label: value }
      );
      if (rpcErr) {
        setErrorMessage(rpcErr.message);
        return;
      }

      if (existingId) {
        const eid = existingId as string;
        if (interestDraft.some((p) => p.id === eid)) {
          setErrorMessage("すでに追加されています。");
          return;
        }
        // 一覧ではまだ0件だが DB には行がある（例: 押す直前に他ユーザーが同じ語を登録）
        // → 新規登録の確認は出さず、趣味・関心の下書きにそのタグを足す
        let labelResolved = catalog.find((p) => p.id === eid)?.label;
        if (!labelResolved) {
          const { data: one } = await supabase
            .from("interest_tags")
            .select("label")
            .eq("id", eid)
            .maybeSingle();
          labelResolved = one?.label;
        }
        const labelPick = labelResolved ?? value;
        addPickById(eid, labelPick);
        mergeCatalogPick({ id: eid, label: labelPick });
        setInterestPickerOpen(false);
        return;
      }

      const insertsRemaining =
        MAX_CUSTOM_INTEREST_REGISTRATIONS - customCreationsUsed;
      if (insertsRemaining <= 0) {
        setErrorMessage(
          `一覧にない新しい語の登録は${MAX_CUSTOM_INTEREST_REGISTRATIONS}つまでです。`
        );
        return;
      }
      setInterestConfirm({
        label: value,
        insertsRemaining,
      });
    } finally {
      setInterestPlusPending(false);
    }
  };

  const confirmCustomInterest = async () => {
    if (!interestConfirm || !userId) return;
    setErrorMessage(null);

    const finish = () => {
      setInterestConfirm(null);
    };

    const quality = validateInterestLabelForRegistration(interestConfirm.label);
    if (quality) {
      setErrorMessage(quality);
      setInterestConfirm(null);
      return;
    }

    const { data: inserted, error: insErr } = await supabase
      .from("interest_tags")
      .insert({
        label: interestConfirm.label,
        is_preset: false,
        created_by: userId,
      })
      .select("id, label")
      .maybeSingle();

    if (insErr) {
      const { data: raceId } = await supabase.rpc(
        "interest_tag_id_by_normalized_label",
        { p_label: interestConfirm.label }
      );
      if (raceId) {
        const rid = raceId as string;
        let raceLabel = presetRows.find((p) => p.id === rid)?.label;
        if (!raceLabel) {
          const { data: row } = await supabase
            .from("interest_tags")
            .select("label")
            .eq("id", rid)
            .maybeSingle();
          raceLabel = row?.label;
        }
        const raceResolved = raceLabel ?? interestConfirm.label;
        addPickById(rid, raceResolved);
        mergeCatalogPick({ id: rid, label: raceResolved });
        setInterestPickerOpen(false);
        finish();
        return;
      }
      setErrorMessage(insErr.message);
      finish();
      return;
    }

    if (inserted) {
      const nextCount = customCreationsUsed + 1;
      const { error: cntErr } = await supabase
        .from("users")
        .update({ interest_custom_creations_count: nextCount })
        .eq("id", userId);
      if (cntErr) {
        setErrorMessage(cntErr.message);
        finish();
        return;
      }
      setCustomCreationsUsed(nextCount);
      addPickById(inserted.id, inserted.label);
      mergeCatalogPick({ id: inserted.id, label: inserted.label });
    }
    setInterestPickerOpen(false);
    finish();
  };

  return (
    <>
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
        {userId &&
        profileReady &&
        !needsPasswordChange &&
        !needsNickname &&
        !needsInviteOnboarding ? (
          <section className="mb-4 text-sm text-gray-700">
            <div className="flex min-w-0 items-start gap-3">
              <UserAvatar
                name={profileNickname}
                avatarUrl={profileAvatarUrl}
                placeholderHex={profilePlaceholderHex}
                size="lg"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-lg font-semibold text-gray-800">
                    {profileNickname ?? "ニックネーム未設定"}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-400"
                      title="シェア機能は未実装です"
                      aria-label="シェア機能未実装"
                    >
                      <svg
                        className="h-3.5 w-3.5 shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <circle cx="18" cy="5" r="3" />
                        <circle cx="6" cy="12" r="3" />
                        <circle cx="18" cy="19" r="3" />
                        <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
                      </svg>
                      <span className="hidden sm:inline">未実装</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleProfileEdit()}
                      className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 sm:p-0 sm:px-2 sm:py-1"
                      aria-label="プロフィールを編集"
                      title="プロフィールを編集"
                    >
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      <span className="hidden text-xs sm:inline">編集</span>
                    </button>
                  </div>
                </div>
                {profileBio ? (
                  <p className="whitespace-pre-wrap text-sm text-gray-700">
                    {profileBio}
                  </p>
                ) : null}
                {interestPicksServer.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                    <span className="shrink-0">趣味・関心:</span>
                    {interestPicksServer.map((p) => (
                      <span
                        key={p.id}
                        className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-900"
                      >
                        {p.label}
                      </span>
                    ))}
                  </div>
                ) : null}
                {profileExternalUrl.trim() ? (
                  <p className="pt-0.5 text-sm">
                    <a
                      href={profileExternalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all font-medium text-sky-800 hover:text-sky-950 hover:underline"
                    >
                      {profileExternalUrl}
                    </a>
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {profileEditOpen ? (
          <div
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-edit-title"
          >
            <div
              className="flex min-h-0 max-h-[min(92dvh,40rem)] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl ring-1 ring-black/5 sm:max-h-[min(88dvh,36rem)] sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <form
                onSubmit={handleProfileSave}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="flex shrink-0 items-start justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
                  <div className="min-w-0">
                    <h3
                      id="profile-edit-title"
                      className="text-sm font-semibold text-gray-900"
                    >
                      プロフィール編集
                    </h3>
                    <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
                      登録日 {joinedAtLabel ?? "不明"}
                      <span className="text-gray-300"> · </span>
                      閲覧フィルタは
                      <button
                        type="button"
                        className="mx-0.5 font-medium text-sky-800 underline-offset-2 hover:underline"
                        onClick={() => requestOpenSettings()}
                      >
                        設定
                      </button>
                      から
                    </p>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <label
                        className="shrink-0 cursor-pointer self-start"
                        title={
                          avatarUploading ? "アップロード中..." : "画像を変更"
                        }
                      >
                        <UserAvatar
                          name={profileNickname}
                          avatarUrl={profileAvatarUrl}
                          placeholderHex={profilePlaceholderHex}
                          size="lg"
                        />
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          className="hidden"
                          disabled={avatarUploading}
                          onChange={(e) => void handleAvatarUpload(e)}
                        />
                      </label>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                          <span className="text-xs font-medium text-gray-700">
                            名前
                          </span>
                          {nicknameLocked ? (
                            <span className="text-[11px] text-gray-500">
                              ※先行体験期間中は名前を変更できません
                            </span>
                          ) : null}
                        </div>
                        <input
                          value={nicknameDraft}
                          onChange={(e) =>
                            setNicknameDraft(
                              e.target.value.replace(/[\n\r]/g, "")
                            )
                          }
                          maxLength={20}
                          disabled={nicknameLocked}
                          className="w-full border-0 border-b border-gray-200 bg-transparent px-0 py-1.5 text-sm outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:text-gray-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-700">
                        自己紹介
                      </label>
                      <AutosizeTextarea
                        value={bioDraft}
                        onChange={(e) => setBioDraft(e.target.value)}
                        maxRows={8}
                        maxLength={PROFILE_BIO_MAX_CHARS}
                        className="mt-1 w-full resize-none overflow-hidden border-0 border-b border-gray-200 bg-transparent px-0 py-1.5 text-sm leading-snug outline-none focus:border-blue-500"
                      />
                      <p className="mt-0.5 text-right text-[11px] text-gray-400">
                        {bioDraft.length}/{PROFILE_BIO_MAX_CHARS}
                      </p>
                    </div>
                    <div>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                        <label className="text-xs font-medium text-gray-700">
                          外部リンク（任意）
                        </label>
                        <span className="text-[11px] text-gray-500">
                          ※httpsのみ対応
                        </span>
                      </div>
                      <input
                        type="url"
                        value={externalUrlDraft}
                        onChange={(e) => setExternalUrlDraft(e.target.value)}
                        maxLength={500}
                        placeholder="https://example.com"
                        className="mt-1 w-full border-0 border-b border-gray-200 bg-transparent px-0 py-1.5 text-sm outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-700">
                        趣味・関心（最大{MAX_INTEREST_TAGS}つ）
                      </label>
                      <div className="mt-1.5 flex min-h-[1.75rem] flex-wrap items-center gap-1.5">
                        {interestDraft.length < MAX_INTEREST_TAGS ? (
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-lg font-medium text-gray-700 hover:bg-gray-200"
                            aria-label="趣味・関心を追加"
                            onClick={() => setInterestPickerOpen(true)}
                          >
                            ＋
                          </button>
                        ) : null}
                        {interestDraft.map((pick) => (
                          <span
                            key={pick.id}
                            className="inline-flex items-center gap-1 rounded-full bg-blue-100/90 px-2 py-0.5 text-xs font-medium text-blue-900"
                          >
                            {pick.label}
                            <button
                              type="button"
                              className="rounded px-0.5 text-blue-700 hover:bg-blue-200/80"
                              aria-label={`${pick.label}を削除`}
                              onClick={() => removeInterestPick(pick.id)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2 border-t border-gray-100 px-4 py-2.5">
                  <button
                    type="submit"
                    disabled={profileSaving}
                    className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {profileSaving ? "保存中..." : "保存"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNicknameDraft(profileNickname ?? "");
                      setBioDraft(
                        profileBio.length > PROFILE_BIO_MAX_CHARS
                          ? profileBio.slice(0, PROFILE_BIO_MAX_CHARS)
                          : profileBio
                      );
                      setExternalUrlDraft(profileExternalUrl);
                      setInterestDraft([...interestPicksServer]);
                      setInterestSearchQuery("");
                      setInterestConfirm(null);
                      setInterestPickerOpen(false);
                      setProfileEditOpen(false);
                    }}
                    className="rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    キャンセル
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {profileEditOpen && interestPickerOpen ? (
          <div
            className="fixed inset-0 z-[75] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
            role="presentation"
            onClick={() => {
              if (!interestConfirm) setInterestPickerOpen(false);
            }}
          >
            <div
              className="flex min-h-0 max-h-[min(88dvh,28rem)] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl ring-1 ring-black/5 sm:rounded-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="interest-picker-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-3 py-2">
                <h4
                  id="interest-picker-title"
                  className="text-sm font-semibold text-gray-900"
                >
                  趣味・関心を追加
                </h4>
                <button
                  type="button"
                  className="rounded-full p-1 text-lg leading-none text-gray-500 hover:bg-gray-100"
                  aria-label="閉じる"
                  onClick={() => setInterestPickerOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
                <p className="mb-2 text-[11px] leading-snug text-gray-500">
                  キーワードで候補を絞り込みます。一覧にない語は「＋」から追加できます。
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={interestSearchQuery}
                    onChange={(e) => {
                      setInterestSearchQuery(
                        e.target.value.replace(/[\n\r]/g, "")
                      );
                      setInterestConfirm(null);
                    }}
                    maxLength={MAX_CUSTOM_INTEREST_LEN}
                    disabled={
                      interestDraft.length >= MAX_INTEREST_TAGS ||
                      interestConfirm != null
                    }
                    placeholder="キーワードで検索"
                    className="min-w-0 flex-1 border-0 border-b border-gray-200 bg-transparent px-0 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    className="shrink-0 self-end rounded-full bg-gray-100 px-3 py-1.5 text-base font-medium text-gray-800 hover:bg-gray-200 disabled:opacity-40"
                    disabled={
                      interestDraft.length >= MAX_INTEREST_TAGS ||
                      !normalizeInterestInput(interestSearchQuery) ||
                      presetSearchHits.length > 0 ||
                      interestConfirm != null ||
                      interestPlusPending
                    }
                    title="検索で0件のときだけ、入力中の言葉を追加できます"
                    onClick={() => void handleInterestPlusClick()}
                  >
                    {interestPlusPending ? "…" : "＋"}
                  </button>
                </div>
                {normalizeInterestInput(interestSearchQuery) &&
                presetSearchHits.length > 0 ? (
                  <ul className="mt-2 max-h-40 overflow-y-auto text-sm">
                    {presetSearchHits.map((pick) => (
                      <li
                        key={pick.id}
                        className="border-b border-gray-100 last:border-0"
                      >
                        <button
                          type="button"
                          className="w-full px-1 py-2 text-left hover:bg-gray-50"
                          onClick={() => {
                            addPresetPick(pick);
                            setInterestPickerOpen(false);
                          }}
                          disabled={interestDraft.length >= MAX_INTEREST_TAGS}
                        >
                          {pick.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

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
        {!userId && authReady ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
            ログイン後にホーム（あなたのプロフィールと投稿一覧）が表示されます。
          </div>
        ) : null}

        {userId && !profileReady ? (
          <p className="text-gray-600">ホームを読み込み中…</p>
        ) : null}

        {userId &&
        profileReady &&
        !needsPasswordChange &&
        !needsNickname &&
        !needsInviteOnboarding ? (
          <section>
            <div className="mb-4 border-t border-gray-200" role="separator" />
            {composeOpen ? (
              <div className="touch-manipulation fixed inset-x-4 bottom-20 z-[55] md:inset-x-auto md:right-6 md:w-[34rem]">
                <form
                  onSubmit={handleSubmitPost}
                  className="touch-manipulation mb-4 flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
                >
                {composeFormError?.trim() ? (
                  <div
                    className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800"
                    role="alert"
                  >
                    {composeFormError}
                  </div>
                ) : null}
                <div className="flex items-end gap-2">
                  <AutosizeTextarea
                    ref={composeTextareaRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="いまどうしてる？"
                    maxRows={12}
                    maxLength={POST_AND_REPLY_MAX_CHARS}
                    disabled={submitting}
                    autoComplete="off"
                    enterKeyHint="send"
                    className="min-h-[2.75rem] min-w-0 flex-1 resize-none overflow-hidden rounded-2xl border border-gray-300 bg-white px-3 py-2 text-sm leading-snug outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
                  />
                  <ImageAttachIconButton
                    disabled={submitting}
                    onPick={(file) => {
                      void (async () => {
                        const r = await preparePostImageForUpload(file);
                        if (!r.ok) {
                          setComposeFormError(r.message);
                          setToast({ message: r.message, tone: "error" });
                          return;
                        }
                        setComposeFormError(null);
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
                        disabled={submitting}
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
                    disabled={
                      submitting || (!draft.trim() && !composePostImage)
                    }
                    className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {submitting ? "投稿中..." : "投稿"}
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setComposeOpen(false);
                      setComposeFormError(null);
                      setDraft("");
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

            {posts.length === 0 ? (
              <p className="text-sm text-gray-500">まだあなたの投稿はありません。</p>
            ) : (
              <ul className="space-y-3">
                {posts.map((post) => (
                  <li
                    key={post.id}
                    id={`home-post-${post.id}`}
                    className="break-words rounded-lg border border-gray-200 bg-white p-4"
                  >
                    <div className="mb-1 flex min-w-0 items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-gray-800">
                        <UserAvatar
                          name={post.users?.nickname ?? null}
                          avatarUrl={post.users?.avatar_url ?? null}
                          placeholderHex={
                            post.users?.avatar_placeholder_hex ?? null
                          }
                        />
                        <span className="line-clamp-2 min-w-0 flex-1 break-words">
                          {post.users?.nickname ?? "（未設定）"}
                        </span>
                      </div>
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
                      canEditOwnPost(post.created_at, userId, post.user_id) ? (
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">
                            編集残り{" "}
                            {formatRemainingLabel(
                              getEditRemainingMs(post.created_at, nowTick)
                            )}
                          </span>
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
                    {editingPostId === post.id ? (
                      <div className="mt-1 space-y-2">
                        <AutosizeTextarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          maxRows={14}
                          maxLength={POST_AND_REPLY_MAX_CHARS}
                          disabled={postEditSaving}
                          className="min-h-[2.75rem] w-full resize-none overflow-hidden rounded-2xl border border-gray-300 bg-white px-3 py-2 text-sm leading-snug outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:opacity-50"
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
                      <button
                        type="button"
                        onClick={() => {
                          if (!tryInteraction()) return;
                          setReplyComposerPostId(post.id);
                          setReplyParentReplyId(null);
                        }}
                        className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50"
                        aria-label="返信"
                        title="返信"
                      >
                        <ReplyBubbleIcon />
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
                                  : thresholdForLevel(DEFAULT_TOXICITY_FILTER_LEVEL)
                              }
                              overThresholdBehavior={toxicityOverThresholdBehavior}
                              replyScoresById={replyScoresById}
                              onEditDraftChange={setEditReplyDraft}
                              onStartEdit={(r) => {
                                setEditingReplyId(r.id);
                                setEditReplyDraft(r.pending_content ?? r.content);
                              }}
                              onCancelEdit={() => setEditingReplyId(null)}
                              onSaveEdit={(rid) =>
                                void handleSaveReplyEdit(rid)
                              }
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
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      {canInteract &&
      replyComposerPostId != null &&
      replyModalContext != null ? (
        <ReplyComposerModal
          open
          onClose={() => {
            if (replySubmittingPostId != null) return;
            setReplyComposerPostId(null);
            setReplyParentReplyId(null);
          }}
          onSubmit={() => void handleReplySubmit(replyComposerPostId)}
          submitting={replySubmittingPostId === replyComposerPostId}
          draft={replyDrafts[replyComposerPostId] ?? ""}
          onDraftChange={(v) =>
            setReplyDrafts((prev) => ({
              ...prev,
              [replyComposerPostId]: v,
            }))
          }
          targetNickname={replyModalContext.targetNickname}
          targetAvatarUrl={replyModalContext.targetAvatarUrl}
          targetPlaceholderHex={replyModalContext.targetPlaceholderHex}
          targetPreview={replyModalContext.targetPreview}
          viewerNickname={profileNickname}
          viewerAvatarUrl={profileAvatarUrl}
          viewerPlaceholderHex={profilePlaceholderHex}
        />
      ) : null}

      <MustChangePasswordModal
        open={Boolean(userId && profileReady && needsPasswordChange)}
        userId={userId}
        inviteLabel={inviteLabel}
        onCompleted={() => {
          setMustChangePassword(false);
        }}
      />

      <NicknameRequiredModal
        open={Boolean(userId && profileReady && needsNickname)}
        nicknameDraft={nicknameDraft}
        onNicknameDraftChange={(v) => {
          setNicknameModalError(null);
          setNicknameDraft(v);
        }}
        onSubmit={handleNicknameRequiredSubmit}
        errorMessage={nicknameModalError}
      />

      {toast?.message?.trim() ? (
        <AppToastPortal message={toast.message} tone={toast.tone} />
      ) : null}

    </main>
    {interestConfirm ? (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4"
        role="presentation"
        onClick={() => setInterestConfirm(null)}
      >
        <div
          className="max-h-[min(90dvh,24rem)] w-full max-w-sm overflow-y-auto overscroll-contain rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="interest-confirm-lead"
          onClick={(e) => e.stopPropagation()}
        >
          <p
            id="interest-confirm-lead"
            className="mb-3 text-sm text-gray-700"
          >
            あと{interestConfirm.insertsRemaining}つ、一覧にない新しい語を登録できます。
          </p>
          <p className="mb-4 text-sm font-medium text-gray-900">
            「{interestConfirm.label}」を登録しますか？
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setInterestConfirm(null)}
            >
              いいえ
            </button>
            <button
              type="button"
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              onClick={() => void confirmCustomInterest()}
            >
              はい
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}

