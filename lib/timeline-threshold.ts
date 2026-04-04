import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_TOXICITY_FILTER_LEVEL,
  parseToxicityFilterLevel,
  thresholdForLevel,
  type ToxicityFilterLevel,
} from "@/lib/toxicity-filter-level";

/** プロフィール未設定時のタイムライン閲覧しきい値（他者の投稿が見える上限） */
export const DEFAULT_TIMELINE_TOXICITY_THRESHOLD = 0.7;

/** プロフィール未設定時のリプ欄閲覧しきい値（タイムラインより厳しめ） */
export const DEFAULT_REPLY_TOXICITY_THRESHOLD = 0.5;

/** 未ログイン時は「標準」レベルの閾値をタイムライン・リプの両方に使う */
export const ANON_TOXICITY_VIEW_THRESHOLD = thresholdForLevel(
  DEFAULT_TOXICITY_FILTER_LEVEL
);

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
