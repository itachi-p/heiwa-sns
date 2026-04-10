/**
 * プロフィール外部リンク用。https のみ許可。javascript: 等は拒否。
 * 返す値はそのまま href に使える正規化済み URL 文字列。
 */
export function sanitizeExternalProfileUrl(
  raw: string | null | undefined
): { ok: true; href: string } | { ok: false; message: string } {
  const t = raw?.trim();
  if (!t) {
    return { ok: true, href: "" };
  }
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { ok: false, message: "URL の形式が正しくありません。" };
  }
  if (u.protocol !== "https:") {
    return { ok: false, message: "https:// で始まる URL のみ登録できます。" };
  }
  const href = u.href;
  if (/^javascript:/i.test(href) || href.includes("javascript:")) {
    return { ok: false, message: "この URL は登録できません。" };
  }
  return { ok: true, href };
}
