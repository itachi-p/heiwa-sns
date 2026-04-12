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

/** テスト用: 5指標の直後にスペースを空けて max（同一行の数値から算出）。狭い幅ではブロック全体が折り返すのみ */
export function ModerationCompactRow({
  scores,
}: {
  scores: Record<string, number>;
}) {
  const maxVal = maxOfScores(scores);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] leading-snug text-gray-600">
      {KEYS.map((k) => (
        <span key={k} className="shrink-0">
          {PERSPECTIVE_ATTRIBUTE_LABEL_JA[k] ?? k}{" "}
          {typeof scores[k] === "number" ? scores[k]!.toFixed(3) : "—"}
        </span>
      ))}
      <span className="ml-0.5 shrink-0 border-l border-gray-200 pl-2 tabular-nums text-gray-700">
        max {maxVal.toFixed(3)}
      </span>
    </div>
  );
}
