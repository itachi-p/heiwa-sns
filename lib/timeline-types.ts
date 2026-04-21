/**
 * タイムライン（`app/(main)/page.tsx`）と関連子コンポーネント間で共有する型。
 * 以前は page.tsx 内にのみ定義されていたが、PostCard 抽出のために分離。
 * 他ページ（home-page / 他人プロフィール）は独自の型を持ったままにしておく
 * （`.cursorrules` に従い、今回のスコープを page.tsx 周りに限定するため）。
 */

export type TimelinePost = {
  id: number;
  content: string;
  pending_content?: string | null;
  created_at?: string;
  user_id?: string;
  moderation_max_score?: number;
  /** 開発用5指標（DB）。閲覧フィルタは moderation_max_score のみ */
  moderation_dev_scores?: unknown;
  image_storage_path?: string | null;
  /** 表示用（posts には保存せず users から解決） */
  users?: {
    nickname: string | null;
    avatar_url?: string | null;
    avatar_placeholder_hex?: string | null;
    public_id?: string | null;
  } | null;
};

export type TimelinePostReply = {
  id: number;
  post_id: number;
  user_id: string;
  content: string;
  pending_content?: string | null;
  created_at?: string;
  parent_reply_id?: number | null;
  moderation_max_score?: number;
  moderation_dev_scores?: unknown;
  users?: {
    nickname: string | null;
    avatar_url?: string | null;
    avatar_placeholder_hex?: string | null;
    public_id?: string | null;
  } | null;
};

export type TimelineToastState = {
  message: string;
  tone: "default" | "error";
};

export function displayTimelineName(
  nickname: string | null | undefined,
  publicId: string | null | undefined
): string {
  const nick = (nickname ?? "").trim();
  if (nick) return nick;
  const pid = (publicId ?? "").trim();
  return pid || "（未設定）";
}
