import { POST_EDIT_WINDOW_MS } from "@/lib/post-edit-window";

/**
 * 投稿・返信の「2行目」取得は、編集窓（作成から POST_EDIT_WINDOW_MS）が終わってから。
 * pending_content がある間は本文未確定のため取得しない（呼び出し側で別チェック）。
 */
export function isPastInitialEditWindow(
  createdAtIso: string | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!createdAtIso) return false;
  const t = new Date(createdAtIso).getTime();
  if (!Number.isFinite(t)) return false;
  return nowMs >= t + POST_EDIT_WINDOW_MS;
}
