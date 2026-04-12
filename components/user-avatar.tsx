"use client";

import { AVATAR_PLACEHOLDER_HEX_RE } from "@/lib/avatar-placeholder";

function displayLetter(name: string | null | undefined) {
  const value = (name ?? "").trim();
  if (!value) return "?";
  return value[0]!.toUpperCase();
}

type UserAvatarProps = {
  name: string | null | undefined;
  avatarUrl?: string | null;
  /** 画像が無いときの丸背景色（#RRGGBB）。未設定時はスレート系 */
  placeholderHex?: string | null;
  /** `xs`: ヘッダー等の狭い行（`sm` より一段小さい） */
  size?: "xs" | "sm" | "lg";
};

export function UserAvatar({
  name,
  avatarUrl,
  placeholderHex,
  size = "sm",
}: UserAvatarProps) {
  const dim =
    size === "lg"
      ? "h-24 w-24 text-2xl"
      : size === "xs"
        ? "h-7 w-7 text-[10px]"
        : "h-8 w-8 text-xs";
  if (avatarUrl) {
    return (
      // 外部 Storage URL のため next/image のドメイン設定より img を使用
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name ? `${name}のアイコン` : "ユーザーアイコン"}
        className={`${dim} shrink-0 rounded-full border border-blue-100 object-cover`}
      />
    );
  }
  const bg =
    placeholderHex && AVATAR_PLACEHOLDER_HEX_RE.test(placeholderHex)
      ? placeholderHex
      : "#64748b";
  return (
    <span
      className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-full font-semibold text-white`}
      style={{ backgroundColor: bg }}
    >
      {displayLetter(name)}
    </span>
  );
}
