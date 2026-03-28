/** 趣味・関心はプリセット＋自作の合算でこの件数まで（別枠の「3+3」ではない） */
export const MAX_INTEREST_TAGS = 3;

/** 自作タグ1件あたりの最大文字数 */
export const MAX_CUSTOM_INTEREST_LEN = 24;

export const PRESET_INTEREST_TAGS = [
  "マンガ",
  "アニメ",
  "映画",
  "動画視聴",
  "音楽鑑賞",
  "ライブ・フェス",
  "お笑い・演芸",
  "ゲーム",
  "ボードゲーム",
  "読書",
  "アウトドア",
  "スポーツ",
  "フィットネス",
  "料理",
  "カフェ",
  "旅行",
  "温泉",
  "動物・ペット",
  "植物・園芸",
  "写真",
  "イラスト・デザイン",
  "プログラミング",
  "学び・教養",
  "美術・博物館",
  "投資",
] as const;

export type PresetInterestTag = (typeof PRESET_INTEREST_TAGS)[number];

const PRESET_SET = new Set<string>(PRESET_INTEREST_TAGS);

export function isPresetInterestTag(s: string): boolean {
  return PRESET_SET.has(s);
}

export function normalizeInterestInput(s: string): string {
  return s.replace(/[\n\r]/g, "").trim().replace(/\s+/g, " ");
}

/** DB の interests 文字列をタグ配列へ（JSON 配列優先・従来の自由記述は移行） */
export function parseInterestsFromDb(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  try {
    const p = JSON.parse(t) as unknown;
    if (Array.isArray(p) && p.every((x) => typeof x === "string")) {
      return uniqTags(
        p.map((x) => normalizeInterestInput(x)).filter(Boolean)
      ).slice(0, MAX_INTEREST_TAGS);
    }
  } catch {
    /* legacy plain text */
  }
  const parts = t
    .split(/[,、]/)
    .map((s) => normalizeInterestInput(s))
    .filter(Boolean);
  if (parts.length > 0) {
    return uniqTags(parts).slice(0, MAX_INTEREST_TAGS);
  }
  return uniqTags([normalizeInterestInput(t)]).slice(0, MAX_INTEREST_TAGS);
}

export function serializeInterestsToDb(tags: string[]): string {
  const cleaned = uniqTags(
    tags.map((x) => normalizeInterestInput(x)).filter(Boolean)
  ).slice(0, MAX_INTEREST_TAGS);
  return JSON.stringify(cleaned);
}

function uniqTags(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** 検索用：query が空なら全プリセット、否则は部分一致 */
export function filterPresetInterests(query: string): string[] {
  const q = normalizeInterestInput(query);
  if (!q) return [...PRESET_INTEREST_TAGS];
  return PRESET_INTEREST_TAGS.filter((p) => p.includes(q));
}

export function validateCustomInterestText(raw: string): string | null {
  const s = normalizeInterestInput(raw);
  if (!s) return "言葉を入力してください。";
  if (s.length > MAX_CUSTOM_INTEREST_LEN) {
    return `一覧にない言葉は${MAX_CUSTOM_INTEREST_LEN}文字以内にしてください。`;
  }
  return null;
}
