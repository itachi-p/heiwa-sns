/** user_affinity.like_score から表示優先度ブースト用の重み（仕様どおり） */
export function affinityDisplayWeight(likeScore: number): number {
  const s = Number.isFinite(likeScore) ? likeScore : 0;
  return 0.5 * (1 - Math.exp(-0.3 * s));
}

/**
 * final_score = base_score * toxicity_weight * (1 + affinity_weight)
 * base_score: 時間（created_at の epoch ms）
 */
export function timelineFinalScore(
  createdAtMs: number,
  toxicityWeight: number,
  likeScore: number
): number {
  const base = Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : 0;
  const tw =
    Number.isFinite(toxicityWeight) && toxicityWeight > 0 ? toxicityWeight : 1;
  const w = affinityDisplayWeight(likeScore);
  return base * tw * (1 + w);
}
