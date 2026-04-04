/**
 * サーバー経由で moderation_dev_scores を永続化（編集窓外の2行目用。service_role 更新）。
 */
export type PersistModerationDevScoresBody = {
  postId?: number;
  replyId?: number;
  patch: {
    first?: Record<string, number>;
    second?: Record<string, number>;
  };
};

export async function persistModerationDevScores(
  body: PersistModerationDevScoresBody
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch("/api/persist-moderation-dev-scores", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (!res.ok) {
    return {
      ok: false,
      error: json?.error ?? `HTTP ${res.status}`,
    };
  }
  return { ok: true };
}
