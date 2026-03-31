"use client";

import React, {
  startTransition,
  useEffect,
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
import {
  buildReplyPerspectiveBlockMessage,
  normalizePerspectiveScores,
  PERSPECTIVE_ATTRIBUTE_LABEL_JA,
  REPLY_PERSPECTIVE_BLOCK_THRESHOLD,
} from "@/lib/perspective-labels";
import { fetchTimelineToxicityThreshold } from "@/lib/timeline-threshold";
import { isMissingAvatarPlaceholderHexError } from "@/lib/users-update-fallback";
import { validateNickname } from "@/lib/nickname";
import {
  canEditOwnPost,
  formatRemainingLabel,
  getEditRemainingMs,
} from "@/lib/post-edit-window";
import { partitionRepliesByParent } from "@/lib/reply-tree";
import {
  loadModerationSnapshotFromStorage,
  parseModerateResponse,
  persistModerationSnapshot,
  PostModerationFixedPortal,
  PostModerationInline,
  type PostModerationSnapshot,
} from "@/components/post-moderation-test-panel";

const supabase = createClient();

type Post = {
  id: number;
  content: string;
  pending_content?: string | null;
  created_at?: string;
  user_id?: string;
  moderation_max_score?: number;
  /** 表示用（posts には保存せず users から解決） */
  users?: {
    nickname: string | null;
    avatar_url?: string | null;
    avatar_placeholder_hex?: string | null;
  } | null;
};

const RELATION_PENALTY_MIN_SCORE = 0.2;
const RELATION_PENALTY_WINDOW_DAYS = 14;
const HIGH_RISK_NOTICE_SCORE = 0.9;

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
  const [timelineToxicityThreshold, setTimelineToxicityThreshold] =
    useState(0.7);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [input, setInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [likedPostIds, setLikedPostIds] = useState<Set<number>>(
    () => new Set()
  );
  const [moderation, setModeration] = useState<PostModerationSnapshot | null>(
    null
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
  /** 返信ごとの直近 AI 判定（テスト表示用） */
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
  const [blockOnSubmit, setBlockOnSubmit] = useState(false);
  const [blockThreshold, setBlockThreshold] = useState(0.7);
  const [composeOpen, setComposeOpen] = useState(false);
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

  const userId = user?.id ?? null;

  const needsNickname =
    Boolean(userId) && profileReady && profileNickname === null;

  useEffect(() => {
    if (!needsNickname) setNicknameModalError(null);
  }, [needsNickname]);

  useEffect(() => {
    const s = loadModerationSnapshotFromStorage();
    if (s) setModeration(s);
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
      content: resolveVisibleContent(p.content, p.pending_content, p.created_at),
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

    const timelinePosts = merged
      .filter((p) => {
        const score =
          typeof p.moderation_max_score === "number" ? p.moderation_max_score : 0;
        return score <= timelineToxicityThreshold;
      })
      .sort((a, b) => {
        const ma = a.user_id ? (relationMultiplierByAuthor.get(a.user_id) ?? 1) : 1;
        const mb = b.user_id ? (relationMultiplierByAuthor.get(b.user_id) ?? 1) : 1;
        if (mb !== ma) return mb - ma;
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });

    setPosts(timelinePosts);

    const postIds = timelinePosts.map((p) => p.id);
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

    setErrorMessage(null);
  };

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
      setTimelineToxicityThreshold(
        await fetchTimelineToxicityThreshold(supabase, userId)
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
  }, [authReady, userId, profileReady]);

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
    setTimelineToxicityThreshold(0.7);
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

      setReplyDrafts((prev) => ({ ...prev, [postId]: "" }));
      setReplyParentReplyId(null);
      /** 判定パネルは残す（閉じる・キャンセル・次の送信開始で消える） */
      await fetchPosts();
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
    setNoticeMessage("編集内容を保存しました。投稿から15分経過後に反映されます。");
    await fetchPosts();
  };

  const handleDeletePost = async (postId: number) => {
    if (!userId) return;
    if (!window.confirm("この投稿を削除しますか？")) return;
    setErrorMessage(null);
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
    setNoticeMessage("編集内容を保存しました。投稿から15分経過後に反映されます。");
    await fetchPosts();
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId) {
      setErrorMessage("ログインしてください。");
      return;
    }
    if (needsNickname) return;
    const content = input.trim();
    if (!content) return;

    let postOverallMax = 0;
    // Test-first: analyze on submit so you can observe score changes quickly.
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
      const snap = parseModerateResponse(json);
      if (snap) {
        setModeration(snap);
        persistModerationSnapshot(snap);
        postOverallMax = snap.overallMax;
      } else if (typeof json?.overallMax === "number") {
        postOverallMax = json.overallMax;
      }
    } catch (err) {
      console.error("moderation error:", err);
      setErrorMessage("AI判定に失敗しました。");
      return;
    }

    const { data, error } = await supabase
      .from("posts")
      .insert({
        content,
        user_id: userId,
        moderation_max_score: postOverallMax,
      })
      .select()
      .single();

    if (error) {
      console.error("insert error:", error);
      setErrorMessage(error.message);
      return;
    }

    if (data) {
      setInput("");
      setComposeOpen(false);
      if (postOverallMax >= HIGH_RISK_NOTICE_SCORE) {
        setNoticeMessage("この投稿は、他の方には表示されにくい可能性があります。");
      } else {
        setNoticeMessage(null);
      }
      await fetchPosts();
    }
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

    setErrorMessage(null);
    setLikedPostIds((prev) => {
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
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
        {noticeMessage?.trim() ? (
          <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            {noticeMessage}
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
                  <PostModerationInline snapshot={moderation} />
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="いまどうしてる？"
                    rows={4}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      className="rounded-md bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700"
                    >
                      投稿
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setComposeOpen(false);
                        setInput("");
                      }}
                      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
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
                          onClick={() => void handleDeletePost(post.id)}
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
            </section>
            {!needsNickname ? (
              <button
                type="button"
                onClick={() => {
                  if (!tryInteraction()) return;
                  setComposeOpen((prev) => !prev);
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

      <PostModerationFixedPortal
        visible={Boolean(canInteract && moderation && !composeOpen)}
        snapshot={moderation}
      />
    </main>
  );
}
