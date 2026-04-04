/**
 * 「2行目」の5指標を取りにいくためのキュー（投稿ID / 返信ID）。
 * 新規投稿・新規返信でも登録し、編集窓（15分）経過後かつ本文確定後に再採点し
 * `moderation_dev_scores.second` へ保存するまで localStorage で追跡する。
 */
import { normalizePerspectiveScores } from "@/lib/perspective-labels";

const POST_IDS_KEY = "heiwa_post_ids_pending_second_moderation_v1";
const REPLY_IDS_KEY = "heiwa_reply_ids_pending_second_moderation_v1";

function readIdSet(key: string): Set<number> {
  if (typeof window === "undefined") return new Set();
  try {
    let raw = window.localStorage.getItem(key);
    if (!raw) {
      const legacy = window.sessionStorage.getItem(key);
      if (legacy) {
        window.localStorage.setItem(key, legacy);
        window.sessionStorage.removeItem(key);
        raw = legacy;
      }
    }
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    const s = new Set<number>();
    if (Array.isArray(arr)) {
      for (const x of arr) {
        const n = Number(x);
        if (Number.isFinite(n)) s.add(n);
      }
    }
    return s;
  } catch {
    return new Set();
  }
}

function writeIdSet(key: string, s: Set<number>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

export function markPostNeedsSecondModeration(postId: number) {
  const s = readIdSet(POST_IDS_KEY);
  s.add(postId);
  writeIdSet(POST_IDS_KEY, s);
}

export function markReplyNeedsSecondModeration(replyId: number) {
  const s = readIdSet(REPLY_IDS_KEY);
  s.add(replyId);
  writeIdSet(REPLY_IDS_KEY, s);
}

export function removePostNeedsSecondModeration(postId: number) {
  const s = readIdSet(POST_IDS_KEY);
  s.delete(postId);
  writeIdSet(POST_IDS_KEY, s);
}

export function removeReplyNeedsSecondModeration(replyId: number) {
  const s = readIdSet(REPLY_IDS_KEY);
  s.delete(replyId);
  writeIdSet(REPLY_IDS_KEY, s);
}

export function loadPostIdsPendingSecondModeration(): number[] {
  return [...readIdSet(POST_IDS_KEY)];
}

export function loadReplyIdsPendingSecondModeration(): number[] {
  return [...readIdSet(REPLY_IDS_KEY)];
}

/** cron の finalize と同じ perspective で採点（5指標のみ使用） */
export async function fetchPerspectiveScoresForText(
  text: string
): Promise<Record<string, number>> {
  const res = await fetch("/api/moderate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, mode: "perspective" }),
  });
  const json = (await res.json()) as {
    error?: string;
    paragraphs?: Array<{ scores?: Record<string, unknown> }>;
  };
  if (!res.ok) {
    throw new Error(json?.error ?? "AI判定に失敗しました。");
  }
  return normalizePerspectiveScores(
    json.paragraphs?.[0]?.scores as Record<string, unknown> | undefined
  );
}
