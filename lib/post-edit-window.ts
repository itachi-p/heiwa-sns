/** 暫定: 自分の投稿を投稿からこの時間だけ編集可能 */
export const POST_EDIT_WINDOW_MS = 15 * 60 * 1000;

export function canEditOwnPost(
  createdAt: string | undefined,
  viewerUserId: string | null,
  postUserId: string | undefined
): boolean {
  if (!viewerUserId || !postUserId || viewerUserId !== postUserId) return false;
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= POST_EDIT_WINDOW_MS;
}

/** 返信本文の編集（投稿と同じ15分窓） */
export function canEditOwnReply(
  createdAt: string | undefined,
  viewerUserId: string | null,
  replyAuthorId: string | undefined
): boolean {
  return canEditOwnPost(createdAt, viewerUserId, replyAuthorId);
}

export function getEditRemainingMs(
  createdAt: string | undefined,
  nowMs: number = Date.now()
): number {
  if (!createdAt) return 0;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, POST_EDIT_WINDOW_MS - (nowMs - t));
}

export function formatRemainingLabel(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const ss = (total % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
