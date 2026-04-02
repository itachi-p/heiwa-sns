/** テスト表示用: 初回投稿時と編集確定時の Perspective 指標スナップショット */
export type ModerationTestScores = {
  first?: Record<string, number>;
  final?: Record<string, number>;
};

export function maxPerspectiveScore(
  scores: Record<string, number> | undefined
): number {
  if (!scores || Object.keys(scores).length === 0) return 0;
  return Math.max(
    0,
    ...Object.values(scores).map((v) => Number(v)).filter(Number.isFinite)
  );
}
