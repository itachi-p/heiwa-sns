import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_TOXICITY_FILTER_LEVEL,
  parseToxicityFilterLevel,
  thresholdForLevel,
  type ToxicityFilterLevel,
} from "@/lib/toxicity-filter-level";

/** 未ログイン時は「標準」レベルの閾値をタイムライン・リプの両方に使う */
export const ANON_TOXICITY_VIEW_THRESHOLD = thresholdForLevel(
  DEFAULT_TOXICITY_FILTER_LEVEL
);

/**
 * toxicity_filter_level（未マイグレーション時は 'normal'）
 */
export async function fetchToxicityFilterLevel(
  client: SupabaseClient,
  userId: string
): Promise<ToxicityFilterLevel> {
  const { data, error } = await client
    .from("users")
    .select("toxicity_filter_level")
    .eq("id", userId)
    .maybeSingle();

  if (error) return DEFAULT_TOXICITY_FILTER_LEVEL;
  const raw = (data as { toxicity_filter_level?: string | null } | null)
    ?.toxicity_filter_level;
  return parseToxicityFilterLevel(raw);
}
