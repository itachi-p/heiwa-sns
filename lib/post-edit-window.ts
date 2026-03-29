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
