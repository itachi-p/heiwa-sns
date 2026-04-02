/** Perspective 属性名 → 日本語（返信ブロックメッセージ用） */
export const PERSPECTIVE_ATTRIBUTE_LABEL_JA: Record<string, string> = {
  TOXICITY: "毒性",
  SEVERE_TOXICITY: "重度の毒性",
  INSULT: "侮辱",
  PROFANITY: "卑語",
  THREAT: "脅威",
};

/**
 * 返信欄: 初回判定の合成がこれ以上なら、投稿者以外には本文を表示しない（投稿は拒否しない）。
 */
export const REPLY_THREAD_HIDE_THRESHOLD = 0.5;

/** @deprecated REPLY_THREAD_HIDE_THRESHOLD と同じ値（旧「ブロック」表現の名残） */
export const REPLY_PERSPECTIVE_BLOCK_THRESHOLD = REPLY_THREAD_HIDE_THRESHOLD;

export function normalizePerspectiveScores(
  raw: Record<string, unknown> | null | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** overallMax > threshold 時の説明文（基準超えた指標を列挙） */
export function buildReplyPerspectiveBlockMessage(
  overallMax: number,
  scores: Record<string, number>,
  threshold: number
): string {
  const flagged = Object.entries(scores)
    .filter(([, v]) => v > threshold)
    .sort((a, b) => b[1] - a[1]);
  const detail =
    flagged.length > 0
      ? flagged
          .map(
            ([k, v]) =>
              `${PERSPECTIVE_ATTRIBUTE_LABEL_JA[k] ?? k}（${v.toFixed(3)}）`
          )
          .join("、")
      : "いずれかの指標の合成により基準を超えています。";
  return `最大スコア ${overallMax.toFixed(3)} が基準（${threshold}）を超えたため返信できません。要因: ${detail}。書き直してください。`;
}
