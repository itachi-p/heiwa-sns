import type { SupabaseClient } from "@supabase/supabase-js";

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

  if (error) return 0.7;
  const v = (data as { timeline_toxicity_threshold?: number | null } | null)
    ?.timeline_toxicity_threshold;
  return typeof v === "number" ? v : 0.7;
}
