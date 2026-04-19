/** 投稿本文の冒頭2行相当を切り詰め、続きがある場合は末尾に … */
export function previewPostSnippet(text: string | null | undefined): string {
  const normalized = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const firstTwo = lines.slice(0, 2);
  const out = firstTwo.join("\n");
  const hasMoreLines = lines.length > 2;
  const maxLen = 160;
  if (out.length > maxLen) {
    return out.slice(0, maxLen).trimEnd() + "…";
  }
  if (hasMoreLines) {
    return out.trimEnd() + "…";
  }
  return out;
}
