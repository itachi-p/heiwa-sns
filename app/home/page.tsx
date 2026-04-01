"use client";

import React, { useEffect, useRef, useState } from "react";
import type { PostgrestError, User } from "@supabase/supabase-js";
import { NicknameRequiredModal } from "@/components/nickname-required-modal";
import { ReplyThread } from "@/components/reply-thread";
import { SiteHeader } from "@/components/site-header";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";
import { pickAvatarPlaceholderHex } from "@/lib/avatar-placeholder";
import { fetchTimelineToxicityThreshold } from "@/lib/timeline-threshold";
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
import { validateNickname } from "@/lib/nickname";
import {
  canEditOwnPost,
  formatRemainingLabel,
  getEditRemainingMs,
} from "@/lib/post-edit-window";
import { partitionRepliesByParent } from "@/lib/reply-tree";
import {
  buildReplyPerspectiveBlockMessage,
  normalizePerspectiveScores,
  PERSPECTIVE_ATTRIBUTE_LABEL_JA,
  REPLY_PERSPECTIVE_BLOCK_THRESHOLD,
} from "@/lib/perspective-labels";
import {
  loadModerationSnapshotFromStorage,
  parseModerateResponse,
  persistModerationSnapshot,
  PostModerationFixedPortal,
  PostModerationInline,
  type PostModerationSnapshot,
} from "@/components/post-moderation-test-panel";

const supabase = createClient();
const HOME_MODERATION_THRESHOLD = 0.7;
const RELATION_PENALTY_MIN_SCORE = 0.2;
const HIGH_RISK_NOTICE_SCORE = 0.9;

type Post = {
  id: number;
  content: string;
  pending_content?: string | null;
  created_at?: string;
  user_id?: string;
  moderation_max_score?: number;
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
  users?: {
    nickname: string | null;
    avatar_url?: string | null;
    avatar_placeholder_hex?: string | null;
  } | null;
};

function resolveVisibleContent(
  content: string,
  pendingContent: string | null | undefined,
  createdAt: string | undefined
) {
  if (!pendingContent?.trim() || !createdAt) return content;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return content;
  if (Date.now() - created < 15 * 60 * 1000) return content;
  return pendingContent;
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

function renderPostScores(scores: Record<string, number> | null | undefined) {
  const keys = ["TOXICITY", "SEVERE_TOXICITY", "INSULT", "PROFANITY", "THREAT"];
  return keys.map((key) => ({
    key,
    label: PERSPECTIVE_ATTRIBUTE_LABEL_JA[key] ?? key,
    value: typeof scores?.[key] === "number" ? scores[key]!.toFixed(3) : "未測定",
  }));
}
type ScoreStages = {
  first?: Record<string, number>;
  second?: Record<string, number>;
};

const POST_SCORE_STORE_KEY = "heiwa_post_scores_by_id";
const REPLY_SCORE_STORE_KEY = "heiwa_reply_scores_by_id";

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [profileNickname, setProfileNickname] = useState<string | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profilePlaceholderHex, setProfilePlaceholderHex] = useState<
    string | null
  >(null);
  const [profileBio, setProfileBio] = useState("");
  const [profileTimelineToxicityThreshold, setProfileTimelineToxicityThreshold] =
    useState(0.7);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [timelineThresholdDraft, setTimelineThresholdDraft] = useState("0.7");
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
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
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
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [moderationMode, setModerationMode] = useState<"mock" | "perspective">(
    "perspective"
  );
  const [blockOnSubmit, setBlockOnSubmit] = useState(true);
  const [blockThreshold, setBlockThreshold] = useState(HOME_MODERATION_THRESHOLD);
  /** 本投稿の直近 AI 判定（/ と同様にテスト表示） */
  const [postModeration, setPostModeration] =
    useState<PostModerationSnapshot | null>(null);
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
  const [replyModerationByPostId, setReplyModerationByPostId] = useState<
    Record<
      number,
      | {
          mode: string;
          overallMax: number;
          scores: Record<string, number>;
        }
      | null
    >
  >({});
  const [replyBlockMessageByPostId, setReplyBlockMessageByPostId] = useState<
    Record<number, string | null>
  >({});
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [interestPlusPending, setInterestPlusPending] = useState(false);
  const [postScoresById, setPostScoresById] = useState<
    Record<number, ScoreStages>
  >({});
  const [replyScoresById, setReplyScoresById] = useState<
    Record<number, ScoreStages>
  >({});
  const profileEditOpenRef = useRef(false);

  const userId = user?.id ?? null;
  const needsNickname =
    Boolean(userId) && profileReady && profileNickname === null;

  useEffect(() => {
    if (!needsNickname) setNicknameModalError(null);
  }, [needsNickname]);

  useEffect(() => {
    const s = loadModerationSnapshotFromStorage();
    if (s) setPostModeration(s);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(POST_SCORE_STORE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next: Record<number, ScoreStages> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const id = Number(k);
        if (!Number.isFinite(id) || !v || typeof v !== "object") continue;
        const obj = v as { first?: unknown; second?: unknown };
        const first =
          obj.first && typeof obj.first === "object"
            ? (obj.first as Record<string, number>)
            : (v as Record<string, number>);
        const second =
          obj.second && typeof obj.second === "object"
            ? (obj.second as Record<string, number>)
            : undefined;
        next[id] = { first, second };
      }
      setPostScoresById(next);
    } catch {
      // ignore malformed local cache
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(REPLY_SCORE_STORE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next: Record<number, ScoreStages> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const id = Number(k);
        if (!Number.isFinite(id) || !v || typeof v !== "object") continue;
        const obj = v as { first?: unknown; second?: unknown };
        const first =
          obj.first && typeof obj.first === "object"
            ? (obj.first as Record<string, number>)
            : (v as Record<string, number>);
        const second =
          obj.second && typeof obj.second === "object"
            ? (obj.second as Record<string, number>)
            : undefined;
        next[id] = { first, second };
      }
      setReplyScoresById(next);
    } catch {
      // ignore malformed local cache
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      POST_SCORE_STORE_KEY,
      JSON.stringify(postScoresById)
    );
  }, [postScoresById]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      REPLY_SCORE_STORE_KEY,
      JSON.stringify(replyScoresById)
    );
  }, [replyScoresById]);

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
        "nickname, avatar_url, avatar_placeholder_hex, bio, interest_custom_creations_count"
      )
      .eq("id", uid)
      .maybeSingle();

    type ProfileRow = {
      nickname: string | null;
      avatar_url: string | null;
      avatar_placeholder_hex?: string | null;
      bio: string | null;
      interest_custom_creations_count?: number | null;
    };

    let profile: ProfileRow | null = profileRes.data as ProfileRow | null;
    if (profileRes.error) {
      const fallback = await supabase
        .from("users")
        .select("nickname, avatar_url, avatar_placeholder_hex, bio")
        .eq("id", uid)
        .maybeSingle();
      if (fallback.error) {
        setErrorMessage(fallback.error.message);
        return;
      }
      profile = fallback.data as ProfileRow | null;
    }

    const threshold = await fetchTimelineToxicityThreshold(supabase, uid);

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
      content: resolveVisibleContent(p.content, p.pending_content, p.created_at),
      users: {
        nickname,
        avatar_url: avatarUrl,
        avatar_placeholder_hex: placeholderHex,
      },
    }));

    const postIds = merged.map((p) => p.id);
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
          content: resolveVisibleContent(r.content, r.pending_content, r.created_at),
          users: {
            nickname: rp?.nickname ?? null,
            avatar_url: rp?.avatar_url ?? null,
            avatar_placeholder_hex: rp?.avatar_placeholder_hex ?? null,
          },
        });
        byPost[r.post_id] = arr;
      }
      setRepliesByPost(byPost);
    }

    setPosts(merged);
    setProfileNickname(nickname);
    setProfileAvatarUrl(avatarUrl);
    setProfilePlaceholderHex(placeholderHex);
    setProfileBio(bio);
    setProfileTimelineToxicityThreshold(threshold);
    setPresetRows((catalogData ?? []) as InterestPick[]);
    setInterestPicksServer(picks);
    if (!profileEditOpenRef.current) {
      setInterestDraft(picks);
    }
    setCustomCreationsUsed(creations);
    setNicknameDraft(nickname ?? "");
    setBioDraft(bio);
    setTimelineThresholdDraft(threshold.toFixed(2));

    const warn = [catalogWarning, uiWarning].filter(Boolean).join(" ");
    setErrorMessage(warn || null);
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
    profileEditOpenRef.current = profileEditOpen;
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
        setNoticeMessage("編集時間が終了しました。最後に保存した内容が15分後に反映されます。");
      }
    }
    if (editingReplyId != null) {
      const allReplies = Object.values(repliesByPost).flat();
      const reply = allReplies.find((r) => r.id === editingReplyId);
      if (reply && getEditRemainingMs(reply.created_at, nowTick) <= 0) {
        setEditingReplyId(null);
        setNoticeMessage("編集時間が終了しました。最後に保存した内容が15分後に反映されます。");
      }
    }
  }, [nowTick, editingPostId, editingReplyId, posts, repliesByPost]);

  useEffect(() => {
    if (!userId || !user) {
      setProfileReady(false);
      setProfileNickname(null);
      setProfilePlaceholderHex(null);
      setPosts([]);
      setRepliesByPost({});
      setReplyDrafts({});
      setReplyComposerPostId(null);
      setReplyModerationByPostId({});
      setReplyBlockMessageByPostId({});
      setEditingPostId(null);
      setReplyParentReplyId(null);
      setEditingReplyId(null);
      setProfileTimelineToxicityThreshold(0.7);
      setTimelineThresholdDraft("0.7");
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
    setReplyModerationByPostId({});
    setReplyBlockMessageByPostId({});
    setEditingPostId(null);
    setReplyParentReplyId(null);
    setEditingReplyId(null);
    setProfileTimelineToxicityThreshold(0.7);
    setTimelineThresholdDraft("0.7");
  };

  const handleDeletePost = async (postId: number) => {
    if (!userId) return;
    const confirmed = window.confirm("この投稿を削除しますか？");
    if (!confirmed) return;

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
    if (!userId) return;
    const content = editDraft.trim();
    if (!content) {
      setErrorMessage("本文を入力してください。");
      return;
    }
    setPostEditSaving(true);
    setErrorMessage(null);
    setNoticeMessage(null);
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
    try {
      const res = await fetch("/api/moderate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: content, mode: moderationMode }),
      });
      const json = (await res.json().catch(() => null)) as
        | { paragraphs?: Array<{ scores?: Record<string, unknown> }> }
        | null;
      const second = normalizePerspectiveScores(
        (json?.paragraphs?.[0]?.scores as Record<string, unknown> | undefined) ??
          {}
      );
      if (Object.keys(second).length > 0) {
        setPostScoresById((prev) => ({
          ...prev,
          [postId]: { ...(prev[postId] ?? {}), second },
        }));
      }
    } catch {
      // keep edit save successful even if test scoring failed
    }
    setNoticeMessage("編集内容を保存しました。投稿から15分経過後に反映されます。");
    await fetchOwnPosts(userId);
  };

  const handleReplySubmit = async (postId: number) => {
    if (!userId) return;
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
    setReplyBlockMessageByPostId((prev) => ({ ...prev, [postId]: null }));

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
        setReplyModerationByPostId((prev) => ({ ...prev, [postId]: null }));
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

      setReplyModerationByPostId((prev) => ({
        ...prev,
        [postId]: {
          mode: json.mode ?? moderationMode,
          overallMax,
          scores,
        },
      }));

      if (overallMax > REPLY_PERSPECTIVE_BLOCK_THRESHOLD) {
        setReplyBlockMessageByPostId((prev) => ({
          ...prev,
          [postId]: buildReplyPerspectiveBlockMessage(
            overallMax,
            scores,
            REPLY_PERSPECTIVE_BLOCK_THRESHOLD
          ),
        }));
        return;
      }

      setReplyBlockMessageByPostId((prev) => ({ ...prev, [postId]: null }));

      const insertRow: {
        post_id: number;
        user_id: string;
        content: string;
        parent_reply_id?: number;
      } = {
        post_id: postId,
        user_id: userId,
        content,
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
      if (insertedReply && Object.keys(scores).length > 0) {
        setReplyScoresById((prev) => ({
          ...prev,
          [insertedReply.id]: { first: scores },
        }));
      }

      setReplyDrafts((prev) => ({ ...prev, [postId]: "" }));
      setReplyParentReplyId(null);
      const targetUserId =
        parentReply?.user_id ??
        posts.find((p) => p.id === postId)?.user_id ??
        null;
      if (
        insertedReply &&
        targetUserId &&
        targetUserId !== userId &&
        overallMax > RELATION_PENALTY_MIN_SCORE &&
        overallMax < REPLY_PERSPECTIVE_BLOCK_THRESHOLD
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
      await fetchOwnPosts(userId);
    } catch (err) {
      console.error("reply moderation error:", err);
      setErrorMessage("AI判定に失敗しました。");
      setReplyModerationByPostId((prev) => ({ ...prev, [postId]: null }));
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
      setErrorMessage("本文を入力してください。");
      return;
    }
    setReplyEditSaving(true);
    setErrorMessage(null);
    setNoticeMessage(null);
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
    try {
      const res = await fetch("/api/moderate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: content, mode: moderationMode }),
      });
      const json = (await res.json().catch(() => null)) as
        | { paragraphs?: Array<{ scores?: Record<string, unknown> }> }
        | null;
      const second = normalizePerspectiveScores(
        (json?.paragraphs?.[0]?.scores as Record<string, unknown> | undefined) ??
          {}
      );
      if (Object.keys(second).length > 0) {
        setReplyScoresById((prev) => ({
          ...prev,
          [replyId]: { ...(prev[replyId] ?? {}), second },
        }));
      }
    } catch {
      // keep edit save successful even if test scoring failed
    }
    setNoticeMessage("編集内容を保存しました。投稿から15分経過後に反映されます。");
    await fetchOwnPosts(userId);
  };

  const canInteract =
    Boolean(userId) && profileReady && !needsNickname;

  const tryInteraction = (): boolean => {
    if (needsNickname) return false;
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

  const handleSubmitPost = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId) return;
    const content = draft.trim();
    if (!content) return;

    setSubmitting(true);
    setErrorMessage(null);

    let postOverallMax = 0;
    let postScores: Record<string, number> = {};
    const moderationRes = await fetch("/api/moderate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: content,
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
      setErrorMessage(moderationJson?.error ?? "AI判定に失敗しました。");
      setSubmitting(false);
      return;
    }

    const snap = parseModerateResponse(moderationJson);
    if (snap) {
      setPostModeration(snap);
      persistModerationSnapshot(snap);
      postOverallMax = snap.overallMax;
      postScores = normalizePerspectiveScores(
        (moderationJson?.paragraphs?.[0]?.scores as
          | Record<string, unknown>
          | undefined) ?? {}
      );
    } else if (typeof moderationJson?.overallMax === "number") {
      postOverallMax = moderationJson.overallMax;
    }

    const { data: inserted, error } = await supabase
      .from("posts")
      .insert({
        content,
        user_id: userId,
        moderation_max_score: postOverallMax,
      })
      .select("id")
      .single();

    if (error) {
      setErrorMessage(error.message);
      setSubmitting(false);
      return;
    }

    setDraft("");
    setComposeOpen(false);
    if (inserted && Object.keys(postScores).length > 0) {
      setPostScoresById((prev) => ({
        ...prev,
        [inserted.id]: { first: postScores },
      }));
    }
    if (postOverallMax >= HIGH_RISK_NOTICE_SCORE) {
      setNoticeMessage("この投稿は、他の方には表示されにくい可能性があります。");
    } else {
      setNoticeMessage(null);
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

    const result = validateNickname(nicknameDraft);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    const parsedThreshold = Number(timelineThresholdDraft);
    const timelineThreshold = Math.max(0.1, Math.min(0.7, parsedThreshold));
    if (!Number.isFinite(parsedThreshold)) {
      setErrorMessage("攻撃性しきい値は数値で入力してください。");
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
    const baseUpdate = {
      nickname: result.value,
      bio: bioDraft.trim(),
      interest_custom_creations_count: customCreationsUsed,
      timeline_toxicity_threshold: timelineThreshold,
    };
    const patch = !profilePlaceholderHex
      ? { ...baseUpdate, avatar_placeholder_hex: hex }
      : baseUpdate;

    let appliedHex: string | null = !profilePlaceholderHex ? hex : null;
    let { error } = await supabase.from("users").update(patch).eq("id", userId);

    if (
      error &&
      isMissingAvatarPlaceholderHexError(error) &&
      appliedHex != null
    ) {
      appliedHex = null;
      ({ error } = await supabase
        .from("users")
        .update(baseUpdate)
        .eq("id", userId));
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

    setProfileNickname(result.value);
    setProfileBio(bioDraft.trim());
    setProfileTimelineToxicityThreshold(timelineThreshold);
    setTimelineThresholdDraft(timelineThreshold.toFixed(2));
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
    setNicknameDraft(result.value);
    await fetchOwnPosts(userId);
  };

  const toggleProfileEdit = () => {
    setProfileEditOpen((prev) => {
      if (!prev) {
        setInterestDraft([...interestPicksServer]);
        setInterestSearchQuery("");
        setInterestConfirm(null);
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
        {userId && profileReady && !needsNickname ? (
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
              </div>
            </div>
          </section>
        ) : null}

        {profileEditOpen ? (
          <div className="fixed inset-0 z-[70] bg-black/35 p-4">
            <div className="mx-auto mt-10 w-full max-w-xl rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
              <form onSubmit={handleProfileSave} className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-800">
                    プロフィール編集
                  </h3>
                  <p className="text-xs text-gray-500">
                    登録日: {joinedAtLabel ?? "不明"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label
                    className="cursor-pointer"
                    title={avatarUploading ? "アップロード中..." : "画像を変更"}
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
                  <span className="text-xs text-gray-500">
                    1MB以下 / PNG JPG WEBP GIF
                  </span>
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-600">名前</label>
                  <input
                    value={nicknameDraft}
                    onChange={(e) =>
                      setNicknameDraft(e.target.value.replace(/[\n\r]/g, ""))
                    }
                    maxLength={20}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-600">
                    自己紹介
                  </label>
                  <textarea
                    value={bioDraft}
                    onChange={(e) => setBioDraft(e.target.value)}
                    maxLength={200}
                    rows={3}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-600">
                    タイムライン攻撃性しきい値（0.1〜0.7）
                  </label>
                  <input
                    type="number"
                    min={0.1}
                    max={0.7}
                    step={0.05}
                    value={timelineThresholdDraft}
                    onChange={(e) => setTimelineThresholdDraft(e.target.value)}
                    className="w-40 rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                  />
                  <p className="text-xs text-gray-500">
                    この値を超える投稿は、あなたのタイムラインに表示しません。
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-600">
                    趣味・関心（上位{MAX_INTEREST_TAGS}つまで）
                  </label>
                  <p className="text-xs text-gray-500">
                    検索結果リストにない言葉は「＋」から追加できます。
                  </p>
                  <div className="flex min-h-[1.75rem] flex-wrap gap-1.5">
                    {interestDraft.map((pick) => (
                      <span
                        key={pick.id}
                        className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-900"
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
                      className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100"
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-lg font-medium leading-none text-gray-700 hover:bg-gray-50 disabled:opacity-50"
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
                      ＋
                    </button>
                  </div>
                  {normalizeInterestInput(interestSearchQuery) &&
                  presetSearchHits.length > 0 ? (
                    <ul className="max-h-36 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 text-sm">
                      {presetSearchHits.map((pick) => (
                        <li key={pick.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left hover:bg-white"
                            onClick={() => addPresetPick(pick)}
                            disabled={
                              interestDraft.length >= MAX_INTEREST_TAGS
                            }
                          >
                            {pick.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
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
                      setBioDraft(profileBio);
                      setTimelineThresholdDraft(
                        profileTimelineToxicityThreshold.toFixed(2)
                      );
                      setInterestDraft([...interestPicksServer]);
                      setInterestSearchQuery("");
                      setInterestConfirm(null);
                      setProfileEditOpen(false);
                    }}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    キャンセル
                  </button>
                </div>
              </form>
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
        {noticeMessage?.trim() ? (
          <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            {noticeMessage}
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

        {userId && profileReady && !needsNickname ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">
              あなたの投稿（新しい順）
            </h2>
            {composeOpen ? (
              <div className="fixed inset-x-4 bottom-20 z-[55] md:inset-x-auto md:right-6 md:w-[34rem]">
                <form
                  onSubmit={handleSubmitPost}
                  className="mb-4 flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
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
                            ※mockモードは特定NGワードのみ検出
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
                <PostModerationInline snapshot={postModeration} />
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="いまどうしてる？"
                  rows={3}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {submitting ? "投稿中..." : "投稿"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setComposeOpen(false);
                      setDraft("");
                    }}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
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
                    className="break-words rounded-lg border border-gray-200 bg-white p-4"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-gray-800">
                        <UserAvatar
                          name={post.users?.nickname ?? null}
                          avatarUrl={post.users?.avatar_url ?? null}
                          placeholderHex={
                            post.users?.avatar_placeholder_hex ?? null
                          }
                        />
                        <span>{post.users?.nickname ?? "（未設定）"}</span>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        {canInteract &&
                        userId &&
                        post.user_id &&
                        canEditOwnPost(post.created_at, userId, post.user_id) ? (
                          <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
                            編集残り{" "}
                            {formatRemainingLabel(
                              getEditRemainingMs(post.created_at, nowTick)
                            )}
                          </span>
                        ) : null}
                        {canInteract &&
                        userId &&
                        post.user_id &&
                        canEditOwnPost(post.created_at, userId, post.user_id) ? (
                          editingPostId === post.id ? (
                            <button
                              type="button"
                              onClick={() => setEditingPostId(null)}
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
                          onClick={() => void handleDeletePost(post.id)}
                          className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {post.created_at
                        ? new Date(post.created_at).toLocaleString()
                        : ""}
                    </div>
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
                        {renderTextWithLinks(post.content)}
                      </div>
                    )}
                    {postScoresById[post.id]?.first ? (
                      <div className="mt-1 rounded-md border border-gray-100 bg-gray-50 p-2 text-xs text-gray-600">
                        <div className="font-medium text-gray-700">
                          攻撃性判定（テスト表示中）
                        </div>
                        <div className="mt-1 text-[11px] text-gray-500">初回投稿</div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {renderPostScores(postScoresById[post.id]?.first).map((item) => (
                            <span
                              key={item.key}
                              className="rounded bg-white px-2 py-0.5 ring-1 ring-gray-200"
                            >
                              {item.label}: {item.value}
                            </span>
                          ))}
                        </div>
                        {postScoresById[post.id]?.second ? (
                          <>
                            <div className="mt-2 text-[11px] text-gray-500">
                              編集確定（15分時点）
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {renderPostScores(postScoresById[post.id]?.second).map(
                                (item) => (
                                  <span
                                    key={`second-${item.key}`}
                                    className="rounded bg-white px-2 py-0.5 ring-1 ring-gray-200"
                                  >
                                    {item.label}: {item.value}
                                  </span>
                                )
                              )}
                            </div>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (!tryInteraction()) return;
                          if (replyComposerPostId === post.id) {
                            setReplyComposerPostId(null);
                            setReplyParentReplyId(null);
                            setReplyModerationByPostId((p) => ({
                              ...p,
                              [post.id]: null,
                            }));
                            setReplyBlockMessageByPostId((p) => ({
                              ...p,
                              [post.id]: null,
                            }));
                          } else {
                            setReplyComposerPostId(post.id);
                            setReplyParentReplyId(null);
                            setReplyModerationByPostId((p) => ({
                              ...p,
                              [post.id]: null,
                            }));
                            setReplyBlockMessageByPostId((p) => ({
                              ...p,
                              [post.id]: null,
                            }));
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
                              editingReplyId={editingReplyId}
                              editReplyDraft={editReplyDraft}
                              replyEditSaving={replyEditSaving}
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
                            setReplyBlockMessageByPostId((p) => ({
                              ...p,
                              [post.id]: null,
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
                        {replyModerationByPostId[post.id] ? (
                          <div className="mb-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs">
                            <div className="font-medium text-gray-800">
                              返信・AI判定（mode:{" "}
                              {replyModerationByPostId[post.id]!.mode} / max:{" "}
                              {replyModerationByPostId[post.id]!.overallMax.toFixed(
                                3
                              )}{" "}
                              / ブロック閾値:{" "}
                              {REPLY_PERSPECTIVE_BLOCK_THRESHOLD}）
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5 text-gray-700">
                              {Object.entries(
                                replyModerationByPostId[post.id]!.scores
                              )
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([k, v]) => (
                                  <span
                                    key={k}
                                    className="rounded bg-white px-2 py-0.5 ring-1 ring-gray-200"
                                  >
                                    {PERSPECTIVE_ATTRIBUTE_LABEL_JA[k] ?? k}:{" "}
                                    {Number(v).toFixed(3)}
                                  </span>
                                ))}
                            </div>
                          </div>
                        ) : null}
                        {replyBlockMessageByPostId[post.id]?.trim() ? (
                          <p className="mb-2 text-sm font-medium leading-snug text-red-600">
                            {replyBlockMessageByPostId[post.id]}
                          </p>
                        ) : null}
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
                              setReplyModerationByPostId((p) => ({
                                ...p,
                                [post.id]: null,
                              }));
                              setReplyBlockMessageByPostId((p) => ({
                                ...p,
                                [post.id]: null,
                              }));
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
            <button
              type="button"
              disabled={interestConfirm != null}
              onClick={() => setComposeOpen((prev) => !prev)}
              className="fixed bottom-5 right-5 z-[10001] inline-flex h-12 w-12 items-center justify-center rounded-full border border-blue-200 bg-blue-600 text-2xl font-semibold text-white shadow-lg hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-30"
              aria-label="投稿フォームを開く"
              title="投稿"
            >
              {composeOpen ? "×" : "+"}
            </button>
          </section>
        ) : null}
      </div>

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

      <PostModerationFixedPortal
        visible={Boolean(
          userId &&
            profileReady &&
            !needsNickname &&
            postModeration &&
            !composeOpen
        )}
        snapshot={postModeration}
      />
    </main>
    {interestConfirm ? (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4"
        role="presentation"
        onClick={() => setInterestConfirm(null)}
      >
        <div
          className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
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

