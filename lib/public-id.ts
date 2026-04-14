/** 公開 ID（URL の @ 以降）。英小文字始まり、3〜30 文字、a-z0-9._- */
const PUBLIC_ID_RE = /^[a-z][a-z0-9._-]{2,29}$/;

export function normalizePublicId(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidPublicIdFormat(s: string): boolean {
  return PUBLIC_ID_RE.test(normalizePublicId(s));
}

export function publicIdValidationMessage(): string {
  return "ID は3〜30文字、英小文字で始め、英小文字・数字・._- のみ使えます。";
}
