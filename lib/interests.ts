/** プロフィールに選べる趣味・関心のタグ数（user_interests の上限） */
export const MAX_INTEREST_TAGS = 3;

/**
 * ユーザーが「一覧にない語」を interest_tags に新規 INSERT できる回数の上限。
 * 既に誰かが登録した語を選ぶだけならこの枠を消費しない。
 */
export const MAX_CUSTOM_INTEREST_REGISTRATIONS = 3;

/** 自作タグ1件あたりの最大文字数（DB check と一致） */
export const MAX_CUSTOM_INTEREST_LEN = 24;

export function normalizeInterestInput(s: string): string {
  return s.replace(/[\n\r]/g, "").trim().replace(/\s+/g, " ");
}

export function validateCustomInterestText(raw: string): string | null {
  const s = normalizeInterestInput(raw);
  if (!s) return "言葉を入力してください。";
  if (s.length > MAX_CUSTOM_INTEREST_LEN) {
    return `一覧にない言葉は${MAX_CUSTOM_INTEREST_LEN}文字以内にしてください。`;
  }
  return null;
}

export type InterestPick = { id: string; label: string };

export function filterPresetRows(
  presets: InterestPick[],
  query: string,
  excludeIds: Set<string>
): InterestPick[] {
  const q = normalizeInterestInput(query);
  if (!q) return [];
  return presets.filter(
    (p) => p.label.includes(q) && !excludeIds.has(p.id)
  );
}
