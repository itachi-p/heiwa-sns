/**
 * ニックネーム: 1〜20文字、trim 後空禁止、改行不可（フロント検証用）
 */
export function validateNickname(raw: string):
  | { ok: true; value: string }
  | { ok: false; message: string } {
  if (/[\n\r]/.test(raw)) {
    return { ok: false, message: "改行は使用できません。" };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "ニックネームを入力してください。" };
  }
  if (trimmed.length > 20) {
    return { ok: false, message: "ニックネームは1〜20文字で入力してください。" };
  }
  return { ok: true, value: trimmed };
}
