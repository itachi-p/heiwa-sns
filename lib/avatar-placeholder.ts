/** 画像未設定時の丸アイコン背景（コントラスト確保済み・白文字想定） */
export const AVATAR_PLACEHOLDER_HEXES = [
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0d9488",
  "#0891b2",
] as const;

export function pickAvatarPlaceholderHex(): string {
  const arr = AVATAR_PLACEHOLDER_HEXES;
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export const AVATAR_PLACEHOLDER_HEX_RE = /^#[0-9A-Fa-f]{6}$/;
