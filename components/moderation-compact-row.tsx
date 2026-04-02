import { PERSPECTIVE_ATTRIBUTE_LABEL_JA } from "@/lib/perspective-labels";

const KEYS = [
  "TOXICITY",
  "SEVERE_TOXICITY",
  "INSULT",
  "PROFANITY",
  "THREAT",
] as const;

function maxOfScores(scores: Record<string, number>): number {
  let m = 0;
  for (const k of KEYS) {
    const v = scores[k];
    if (typeof v === "number" && Number.isFinite(v)) m = Math.max(m, v);
  }
  return m;
}

/** テスト用: 5指標を1行に並べ、右端に max（同一行の数値から算出） */
export function ModerationCompactRow({
  scores,
}: {
  scores: Record<string, number>;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px] leading-snug text-gray-600">
      <span className="min-w-0 flex flex-wrap gap-x-2 gap-y-0.5">
        {KEYS.map((k) => (
          <span key={k}>
            {PERSPECTIVE_ATTRIBUTE_LABEL_JA[k] ?? k}{" "}
            {typeof scores[k] === "number" ? scores[k]!.toFixed(3) : "—"}
          </span>
        ))}
      </span>
      <span className="shrink-0 tabular-nums text-gray-700">
        max {maxOfScores(scores).toFixed(3)}
      </span>
    </div>
  );
}
