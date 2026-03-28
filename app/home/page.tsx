"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import type { PostgrestError, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
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

const supabase = createClient();
const HOME_MODERATION_THRESHOLD = 0.7;

type Post = {
  id: number;
  content: string;
  created_at?: string;
  user_id?: string;
  users?: { nickname: string | null; avatar_url?: string | null } | null;
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

function getAvatarLabel(name: string | null | undefined) {
  const value = (name ?? "").trim();
  if (!value) return "?";
  return value[0]!.toUpperCase();
}

function Avatar({
  name,
  avatarUrl,
  size = "sm",
}: {
  name: string | null | undefined;
  avatarUrl?: string | null;
  size?: "sm" | "lg";
}) {
  const sizeClass =
    size === "lg"
      ? "h-24 w-24 text-2xl"
      : "h-8 w-8 text-xs";
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name ? `${name}のアイコン` : "ユーザーアイコン"}
        className={`${sizeClass} shrink-0 rounded-full border border-blue-100 object-cover`}
      />
    );
  }
  return (
    <span
      className={`inline-flex ${sizeClass} shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700`}
    >
      {getAvatarLabel(name)}
    </span>
  );
}

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [profileNickname, setProfileNickname] = useState<string | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profileBio, setProfileBio] = useState("");
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
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [moderationMode, setModerationMode] = useState<"mock" | "perspective">(
    "mock"
  );
  const [blockOnSubmit, setBlockOnSubmit] = useState(true);
  const [blockThreshold, setBlockThreshold] = useState(HOME_MODERATION_THRESHOLD);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const profileEditOpenRef = useRef(false);

  const userId = user?.id ?? null;
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
      .select("nickname, avatar_url, bio, interest_custom_creations_count")
      .eq("id", uid)
      .maybeSingle();

    type ProfileRow = {
      nickname: string | null;
      avatar_url: string | null;
      bio: string | null;
      interest_custom_creations_count?: number | null;
    };

    let profile: ProfileRow | null = profileRes.data as ProfileRow | null;
    if (profileRes.error) {
      const fallback = await supabase
        .from("users")
        .select("nickname, avatar_url, bio")
        .eq("id", uid)
        .maybeSingle();
      if (fallback.error) {
        setErrorMessage(fallback.error.message);
        return;
      }
      profile = fallback.data as ProfileRow | null;
    }

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
    const bio = profile?.bio ?? "";
    const merged = ((rows ?? []) as Post[]).map((p) => ({
      ...p,
      users: { nickname, avatar_url: avatarUrl },
    }));

    setPosts(merged);
    setProfileNickname(nickname);
    setProfileAvatarUrl(avatarUrl);
    setProfileBio(bio);
    setPresetRows((catalogData ?? []) as InterestPick[]);
    setInterestPicksServer(picks);
    if (!profileEditOpenRef.current) {
      setInterestDraft(picks);
    }
    setCustomCreationsUsed(creations);
    setNicknameDraft(nickname ?? "");
    setBioDraft(bio);

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
    if (!userId || !user) {
      setProfileReady(false);
      setProfileNickname(null);
      setPosts([]);
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

    setPosts((prev) => prev.filter((p) => p.id !== postId));
    setErrorMessage(null);
  };

  const handleSubmitPost = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId) return;
    const content = draft.trim();
    if (!content) return;

    setSubmitting(true);
    setErrorMessage(null);

    const moderationRes = await fetch("/api/moderate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: content,
        mode: moderationMode,
      }),
    });
    const moderationJson = (await moderationRes.json().catch(() => null)) as
      | { overallMax?: number; error?: string }
      | null;
    if (!moderationRes.ok) {
      setErrorMessage(moderationJson?.error ?? "AI判定に失敗しました。");
      setSubmitting(false);
      return;
    }

    if (
      blockOnSubmit &&
      typeof moderationJson?.overallMax === "number" &&
      moderationJson.overallMax >= blockThreshold
    ) {
      setErrorMessage(
        `AI判定スコアが高いため投稿を保留しました（max=${moderationJson.overallMax.toFixed(
          3
        )}）。`
      );
      setSubmitting(false);
      return;
    }

    const { error } = await supabase
      .from("posts")
      .insert({ content, user_id: userId });

    if (error) {
      setErrorMessage(error.message);
      setSubmitting(false);
      return;
    }

    setDraft("");
    setComposeOpen(false);
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

    const { error } = await supabase
      .from("users")
      .update({
        nickname: result.value,
        bio: bioDraft.trim(),
        interest_custom_creations_count: customCreationsUsed,
      })
      .eq("id", userId);

    if (error) {
      const pgErr = error as PostgrestError;
      if (pgErr.code === "23505") {
        setErrorMessage("そのニックネームは既に使われています。");
      } else {
        setErrorMessage(error.message);
      }
      setProfileSaving(false);
      return;
    }

    setProfileNickname(result.value);
    setProfileBio(bioDraft.trim());
    await fetchOwnPosts(userId);
    setProfileSaving(false);
    setProfileEditOpen(false);
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
    if (!userId) return;
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
      let labelForPick = presetRows.find((p) => p.id === eid)?.label;
      if (!labelForPick) {
        const { data: row } = await supabase
          .from("interest_tags")
          .select("label")
          .eq("id", eid)
          .maybeSingle();
        labelForPick = row?.label;
      }
      const labelResolved = labelForPick ?? value;
      addPickById(eid, labelResolved);
      mergeCatalogPick({ id: eid, label: labelResolved });
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
  };

  const confirmCustomInterest = async () => {
    if (!interestConfirm || !userId) return;
    setErrorMessage(null);

    const quality = validateInterestLabelForRegistration(interestConfirm.label);
    if (quality) {
      setErrorMessage(quality);
      setInterestConfirm(null);
      return;
    }

    const finish = () => {
      setInterestConfirm(null);
    };

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
      <div className="mx-auto max-w-xl p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">Nagi-SNS（仮名）</h1>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 text-sm">
            {!authReady ? (
              <span className="text-gray-500">読み込み中…</span>
            ) : userId ? (
              <button
                type="button"
                onClick={() => void signOut()}
                className="rounded border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50"
              >
                ログアウト
              </button>
            ) : null}
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2 text-sm">
          <Link
            href="/"
            className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50"
          >
            タイムライン
          </Link>
          <span className="rounded bg-blue-100 px-2 py-1 font-medium text-blue-700">
            ホーム
          </span>
        </div>

        {userId && profileReady ? (
          <section className="mb-4 text-sm text-gray-700">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-3">
                <Avatar
                  name={profileNickname}
                  avatarUrl={profileAvatarUrl}
                  size="lg"
                />
                <div className="min-w-0 space-y-1">
                  <p className="text-lg font-semibold text-gray-800">
                    {profileNickname ?? "ニックネーム未設定"}
                  </p>
                  {profileBio ? (
                    <p className="whitespace-pre-wrap text-sm text-gray-700">
                      {profileBio}
                    </p>
                  ) : null}
                  {interestPicksServer.length > 0 ? (
                    <p className="text-xs text-gray-600">
                      趣味・関心:{" "}
                      {interestPicksServer.map((p) => p.label).join(" · ")}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggleProfileEdit()}
                className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                プロフィール編集
              </button>
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
                    <Avatar
                      name={profileNickname}
                      avatarUrl={profileAvatarUrl}
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
                      disabled={interestDraft.length >= MAX_INTEREST_TAGS}
                      placeholder="キーワードで検索"
                      className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100"
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-lg font-medium leading-none text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      disabled={
                        interestDraft.length >= MAX_INTEREST_TAGS ||
                        !normalizeInterestInput(interestSearchQuery) ||
                        presetSearchHits.length > 0
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

        {errorMessage ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errorMessage}
          </div>
        ) : null}

        {!userId && authReady ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
            ログイン後にホーム（あなたの投稿一覧）を表示します。{" "}
            <Link href="/" className="text-blue-700 underline">
              タイムラインへ戻る
            </Link>
          </div>
        ) : null}

        {userId && !profileReady ? (
          <p className="text-gray-600">ホームを読み込み中…</p>
        ) : null}

        {userId && profileReady ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">
              あなたの投稿（新しい順）
            </h2>
            {composeOpen ? (
              <div className="fixed inset-x-4 bottom-20 z-50 md:inset-x-auto md:right-6 md:w-[34rem]">
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
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                        <Avatar
                          name={post.users?.nickname ?? null}
                          avatarUrl={post.users?.avatar_url ?? null}
                        />
                        <span>{post.users?.nickname ?? "（未設定）"}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeletePost(post.id)}
                        className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                      >
                        削除
                      </button>
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {post.created_at ? new Date(post.created_at).toLocaleString() : ""}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words">
                      {renderTextWithLinks(post.content)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => setComposeOpen((prev) => !prev)}
              className="fixed bottom-5 right-5 z-50 inline-flex h-12 w-12 items-center justify-center rounded-full border border-blue-200 bg-blue-600 text-2xl font-semibold text-white shadow-lg hover:bg-blue-700"
              aria-label="投稿フォームを開く"
              title="投稿"
            >
              {composeOpen ? "×" : "+"}
            </button>
          </section>
        ) : null}
      </div>
    </main>
    {interestConfirm ? (
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4"
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
            「{interestConfirm.label}」を一覧に追加しますか？
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

