/**
 * 閲覧側フィルタのレベル別しきい値（`moderation_max_score` と比較）。
 * 運用で全体を下げる（例: 「標準」を 0.6 付近にする）ことは想定している。
 * 調整するときはこのオブジェクトと {@link HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD} をまとめて見る。
 */
export const TOXICITY_THRESHOLDS = {
  strict: 0.3,
  soft: 0.5,
  normal: 0.7,
  off: 1.0,
} as const;

/**
 * この値以下のスコアは閲覧フィルタでは実質ノイズ扱い（しきい値との比較前に 0 に正規化）。
 * レベル閾値を 0.1 未満に下げるチューニングは、現状の想定では意味がほぼない。
 */
export const TOXICITY_SCORE_NOISE_FLOOR = 0.1;

/**
 * 投稿直後・返信直後に投稿者へ「見えにくくなるかも」と出すライン。
 * レベル閾値（TOXICITY_THRESHOLDS）とは独立に調整してよい。
 */
export const HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD = 0.8;

export type ToxicityFilterLevel = keyof typeof TOXICITY_THRESHOLDS;

export const DEFAULT_TOXICITY_FILTER_LEVEL: ToxicityFilterLevel = "normal";

const LEVEL_SET = new Set<string>(Object.keys(TOXICITY_THRESHOLDS));

export function parseToxicityFilterLevel(
  raw: string | null | undefined
): ToxicityFilterLevel {
  if (raw && LEVEL_SET.has(raw)) {
    return raw as ToxicityFilterLevel;
  }
  return DEFAULT_TOXICITY_FILTER_LEVEL;
}

export function thresholdForLevel(level: ToxicityFilterLevel): number {
  return TOXICITY_THRESHOLDS[level];
}

/** タイムライン除外・リプ折りたたみ判定用（ノイズフロア適用後のスコア） */
export function effectiveScoreForViewerToxicityFilter(
  moderationMaxScore: number | null | undefined
): number {
  const s =
    typeof moderationMaxScore === "number" && Number.isFinite(moderationMaxScore)
      ? moderationMaxScore
      : 0;
  return s <= TOXICITY_SCORE_NOISE_FLOOR ? 0 : s;
}

/** プロフィール「表示フィルタ」の表示順・ラベル */
export const TOXICITY_FILTER_SELECT_ORDER: ToxicityFilterLevel[] = [
  "strict",
  "soft",
  "normal",
  "off",
];

export const TOXICITY_FILTER_LEVEL_LABELS: Record<ToxicityFilterLevel, string> =
  {
    strict: "厳しめ（安心重視）",
    soft: "やや厳しめ",
    normal: "標準",
    off: "フィルタしない",
  };
