/** Perspective 属性名 → 日本語 */
export const PERSPECTIVE_ATTRIBUTE_LABEL_JA: Record<string, string> = {
  TOXICITY: "毒性",
  SEVERE_TOXICITY: "重度の毒性",
  INSULT: "侮辱",
  PROFANITY: "卑語",
  THREAT: "脅威",
};

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
