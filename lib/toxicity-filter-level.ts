/**
 * 閲覧側フィルタのレベル別しきい値（`moderation_max_score` と比較）。
 * 運用で全体を下げる（例: 「標準」を 0.6 付近にする）ことは想定している。
 * 調整するときはこのオブジェクトと {@link HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD} をまとめて見る。
 */
export const TOXICITY_THRESHOLDS = {
  /** 厳しめ（安心重視） */
  strict: 0.3,
  /** やや厳しめ */
  soft: 0.5,
  /** 標準（デフォルト） */
  normal: 0.7,
  off: 1.0,
} as const;

/**
 * Perspective 等の `moderation_max_score` を閲覧比較に使う前のノイズ下限（DB の保存値は変えない）。
 * **この値以下は `effectiveScoreForViewerToxicityFilter` が 0** — 閲覧フィルタの除外判定・
 * （同じ有効スコアを参照する箇所の）表示順ペナルティの対象外。将来 0.1 に下げる等の調整はここだけ。
 */
export const TOXICITY_SCORE_NOISE_FLOOR = 0.2;

/**
 * 投稿直後・返信直後に投稿者へ「見えにくくなるかも」と出すライン。
 * 既定閲覧フィルタ「標準」と同じ値（{@link TOXICITY_THRESHOLDS.normal}）に揃える。
 * 閲覧者が「フィルタしない」(off) のときのみ、閾値超の投稿もタイムライン・リプでそのまま見える。
 */
export const HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD = TOXICITY_THRESHOLDS.normal;

export type ToxicityFilterLevel = keyof typeof TOXICITY_THRESHOLDS;

export const DEFAULT_TOXICITY_FILTER_LEVEL: ToxicityFilterLevel = "normal";

/** 閾値超コンテンツの扱い（表示しない / 折りたたんで見せる） */
export const TOXICITY_OVER_THRESHOLD_BEHAVIORS = ["hide", "fold"] as const;
export type ToxicityOverThresholdBehavior =
  (typeof TOXICITY_OVER_THRESHOLD_BEHAVIORS)[number];
export const DEFAULT_TOXICITY_OVER_THRESHOLD_BEHAVIOR: ToxicityOverThresholdBehavior =
  "hide";
const OVER_THRESHOLD_BEHAVIOR_SET = new Set<string>(
  TOXICITY_OVER_THRESHOLD_BEHAVIORS
);

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

export function parseToxicityOverThresholdBehavior(
  raw: string | null | undefined
): ToxicityOverThresholdBehavior {
  if (raw && OVER_THRESHOLD_BEHAVIOR_SET.has(raw)) {
    return raw as ToxicityOverThresholdBehavior;
  }
  return DEFAULT_TOXICITY_OVER_THRESHOLD_BEHAVIOR;
}

export const TOXICITY_OVER_THRESHOLD_BEHAVIOR_LABELS: Record<
  ToxicityOverThresholdBehavior,
  string
> = {
  hide: "非表示（存在を出さない）",
  fold: "折りたたみ（展開で見る）",
};

/**
 * タイムライン除外・リプ折りたたみ判定用。
 * 引数は DB に保存された `moderation_max_score`（投稿ごとに固定）。返す値だけが閲覧側比較用。
 * フロア以下は比較上「閾値未満」とみなすため 0 を返す（保存値を書き換えるわけではない）。
 * INSERT/UPDATE には使わない（スコアの永続化は投稿・確定フローで Perspective の値をそのまま書く）。
 */
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
