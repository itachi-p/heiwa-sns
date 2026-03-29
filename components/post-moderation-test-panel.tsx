"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

const STORAGE_KEY = "heiwa_last_post_moderation_v1";

export type PostModerationSnapshot = {
  mode: string;
  overallMax: number;
  truncated: boolean;
  paragraphs: Array<{
    index: number;
    text: string;
    maxScore: number;
    scores: Record<string, number>;
  }>;
};

function coerceScores(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const n = typeof val === "number" ? val : Number(val);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** /api/moderate の JSON から表示用スナップショットを組み立てる */
export function parseModerateResponse(json: unknown): PostModerationSnapshot | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const rawParagraphs = Array.isArray(j.paragraphs) ? j.paragraphs : [];
  const paragraphs = rawParagraphs.map((p, i) => {
    const row = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    return {
      index: typeof row.index === "number" ? row.index : i,
      text: typeof row.text === "string" ? row.text : "",
      maxScore:
        typeof row.maxScore === "number"
          ? row.maxScore
          : Number(row.maxScore) || 0,
      scores: coerceScores(row.scores),
    };
  });
  const overallMax =
    typeof j.overallMax === "number"
      ? j.overallMax
      : Number(j.overallMax) || 0;
  return {
    mode: typeof j.mode === "string" ? j.mode : "perspective",
    overallMax,
    truncated: Boolean(j.truncated),
    paragraphs,
  };
}

export function persistModerationSnapshot(s: PostModerationSnapshot) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function loadModerationSnapshotFromStorage(): PostModerationSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PostModerationSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    return parseModerateResponse(parsed) ?? parsed;
  } catch {
    return null;
  }
}

function ScoreChips({ scores }: { scores: Record<string, number> }) {
  const entries = Object.entries(scores).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return (
      <p className="mt-2 text-xs text-gray-500">
        属性別スコアは取得できませんでした（max のみ参照）。
      </p>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-700">
      {entries.map(([k, v]) => (
        <span key={k} className="rounded bg-gray-100 px-2 py-1">
          {k}: {Number(v).toFixed(3)}
        </span>
      ))}
    </div>
  );
}

/** コンポーザー内（折りたたみの外） */
export function PostModerationInline({
  snapshot,
  title = "直近の判定（投稿するまで表示）",
}: {
  snapshot: PostModerationSnapshot | null;
  title?: string;
}) {
  if (!snapshot) return null;
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50/80 p-3">
      <div className="text-sm font-medium text-gray-800">{title}</div>
      <div className="mt-1 text-xs text-gray-600">
        mode: {snapshot.mode} / max: {snapshot.overallMax.toFixed(3)}
        {snapshot.truncated ? " / 要約あり" : ""}
      </div>
      <ScoreChips scores={snapshot.paragraphs?.[0]?.scores ?? {}} />
    </div>
  );
}

/** 投稿後など — body 直下にポータル（スタッキング文脈の影響を受けない） */
export function PostModerationFixedPortal({
  visible,
  snapshot,
  title = "直近の投稿のAI判定（テスト用）",
}: {
  visible: boolean;
  snapshot: PostModerationSnapshot | null;
  title?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || typeof document === "undefined") return null;
  if (!visible || !snapshot) return null;

  return createPortal(
    <div
      className={[
        "pointer-events-auto fixed inset-x-4 bottom-20 z-[9999] max-h-[40vh] overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 shadow-xl",
        "md:inset-x-auto md:right-6 md:w-[34rem]",
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-gray-800">{title}</div>
        <div className="text-xs text-gray-500">
          mode: {snapshot.mode} / max: {snapshot.overallMax.toFixed(3)}
          {snapshot.truncated ? " / 要約あり" : ""}
        </div>
      </div>
      <ScoreChips scores={snapshot.paragraphs?.[0]?.scores ?? {}} />
    </div>,
    document.body
  );
}
