import type { SupabaseClient } from "@supabase/supabase-js";

/** プロフィール未設定時のタイムライン閲覧しきい値（他者の投稿が見える上限） */
export const DEFAULT_TIMELINE_TOXICITY_THRESHOLD = 0.7;

/** プロフィール未設定時のリプ欄閲覧しきい値（タイムラインより厳しめ） */
export const DEFAULT_REPLY_TOXICITY_THRESHOLD = 0.5;

/**
 * timeline_toxicity_threshold カラムが未マイグレーションの DB では別クエリが失敗する。
 * 失敗時はデフォルト 0.7 を返し、メインの users 取得（nickname 等）を壊さない。
 */
export async function fetchTimelineToxicityThreshold(
  client: SupabaseClient,
  userId: string
): Promise<number> {
  const { data, error } = await client
    .from("users")
    .select("timeline_toxicity_threshold")
    .eq("id", userId)
    .maybeSingle();

  if (error) return DEFAULT_TIMELINE_TOXICITY_THRESHOLD;
  const v = (data as { timeline_toxicity_threshold?: number | null } | null)
    ?.timeline_toxicity_threshold;
  return typeof v === "number" ? v : DEFAULT_TIMELINE_TOXICITY_THRESHOLD;
}

/**
 * リプ欄用の閲覧しきい値（未マイグレーション時は 0.5）
 */
export async function fetchReplyToxicityThreshold(
  client: SupabaseClient,
  userId: string
): Promise<number> {
  const { data, error } = await client
    .from("users")
    .select("reply_toxicity_threshold")
    .eq("id", userId)
    .maybeSingle();

  if (error) return DEFAULT_REPLY_TOXICITY_THRESHOLD;
  const v = (data as { reply_toxicity_threshold?: number | null } | null)
    ?.reply_toxicity_threshold;
  return typeof v === "number" ? v : DEFAULT_REPLY_TOXICITY_THRESHOLD;
}
