/** プロフィールに選べる趣味・関心のタグ数（user_interests の上限） */
export const MAX_INTEREST_TAGS = 3;

/**
 * ユーザーが「一覧にない語」を interest_tags に新規 INSERT できる回数の上限。
 * users.interest_custom_creations_count と一致させる。
 */
export const MAX_CUSTOM_INTEREST_REGISTRATIONS = 3;

/** 自作タグ1件あたりの最大文字数（DB check と一致） */
export const MAX_CUSTOM_INTEREST_LEN = 24;

export function normalizeInterestInput(s: string): string {
  return s.replace(/[\n\r]/g, "").trim().replace(/\s+/g, " ");
}

/** ひらがな・カタカナ（全角・半角）の1文字だけは登録不可。「詩」など1文字の漢字は可 */
function isSingleKanaChar(s: string): boolean {
  const chars = [...s];
  if (chars.length !== 1) return false;
  const cp = chars[0]!.codePointAt(0)!;
  if (cp >= 0x3040 && cp <= 0x309f) return true;
  if (cp >= 0x30a0 && cp <= 0x30ff) return true;
  if (cp >= 0xff66 && cp <= 0xff9f) return true;
  return false;
}

/** 「ああ」「いいい」のように同じ文字の繰り返しだけ */
function isOnlyRepeatedSingleCharacter(s: string): boolean {
  const chars = [...s];
  if (chars.length < 2) return false;
  const first = chars[0]!;
  return chars.every((c) => c === first);
}

export function validateCustomInterestText(raw: string): string | null {
  const s = normalizeInterestInput(raw);
  if (!s) return "言葉を入力してください。";
  if (s.length > MAX_CUSTOM_INTEREST_LEN) {
    return `一覧にない言葉は${MAX_CUSTOM_INTEREST_LEN}文字以内にしてください。`;
  }
  return null;
}

/** 長さチェックに加え、無意味な仮名1文字・同一文字連打を弾く */
export function validateInterestLabelForRegistration(raw: string): string | null {
  const basic = validateCustomInterestText(raw);
  if (basic) return basic;
  const s = normalizeInterestInput(raw);
  if (isOnlyRepeatedSingleCharacter(s)) {
    return "同じ文字だけの連続では登録できません。";
  }
  if (isSingleKanaChar(s)) {
    return "1文字の仮名だけでは登録できません。";
  }
  return null;
}

export type InterestPick = { id: string; label: string };

/**
 * 検索ヒット: 部分一致、または interest_tag_id_by_normalized_label と同様の正規化一致。
 * （大文字小文字・前後空白の違いで「一覧に出ないのに＋は押せる」を防ぐ）
 */
export function filterPresetRows(
  presets: InterestPick[],
  query: string,
  excludeTagIds: Set<string>
): InterestPick[] {
  const q = normalizeInterestInput(query);
  if (!q) return [];
  const qKey = q.toLowerCase();
  return presets.filter((p) => {
    if (excludeTagIds.has(p.id)) return false;
    if (p.label.includes(q)) return true;
    return normalizeInterestInput(p.label).toLowerCase() === qKey;
  });
}
