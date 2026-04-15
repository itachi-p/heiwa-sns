/** 公開 ID（@ 以降に表示）。5〜20 文字、英数字（小文字化後）と ._- のみ */
export const PUBLIC_ID_MIN_LEN = 5;
export const PUBLIC_ID_MAX_LEN = 20;

const PUBLIC_ID_RE = /^[a-z0-9._-]{5,20}$/;

export function normalizePublicId(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidPublicIdFormat(s: string): boolean {
  return PUBLIC_ID_RE.test(normalizePublicId(s));
}

export function publicIdValidationMessage(): string {
  return `ID は${PUBLIC_ID_MIN_LEN}〜${PUBLIC_ID_MAX_LEN}文字で、英数字と ._- のみ使えます。`;
}
