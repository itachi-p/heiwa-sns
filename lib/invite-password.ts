/** 初回ログイン後の必須パスワード変更用（最低限の強度） */
export function validateMandatoryNewPassword(pw: string):
  | { ok: true; value: string }
  | { ok: false; message: string } {
  const t = pw.trim();
  if (t.length < 8) {
    return { ok: false, message: "8文字以上にしてください。" };
  }
  if (t.length > 128) {
    return { ok: false, message: "128文字以内にしてください。" };
  }
  if (!/[a-zA-Z]/.test(t)) {
    return { ok: false, message: "英字を含めてください。" };
  }
  if (!/[0-9]/.test(t)) {
    return { ok: false, message: "数字を含めてください。" };
  }
  return { ok: true, value: t };
}
