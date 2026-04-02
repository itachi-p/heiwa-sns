/** /api/moderate の JSON から投稿用スナップショットを組み立てる（UI 用。DB には書かない） */

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
