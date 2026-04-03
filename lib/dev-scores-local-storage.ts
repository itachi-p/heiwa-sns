/** テスト用5指標（DB には保存しない）。同一オリジンの localStorage — ログインユーザーに依存しない */

export const POST_DEV_SCORES_KEY = "heiwa_post_dev_five_scores_v1";
export const REPLY_DEV_SCORES_KEY = "heiwa_reply_dev_five_scores_v1";

export type DevFiveScores = {
  first?: Record<string, number>;
  second?: Record<string, number>;
};

export type DevScoresById = Record<number, DevFiveScores>;

function backupKey(key: string) {
  return `${key}_backup`;
}

function hasScoresRecord(r: Record<string, number> | undefined): boolean {
  return Boolean(r && Object.keys(r).length > 0);
}

export function hasAnyScores(v: DevFiveScores | undefined): boolean {
  if (!v) return false;
  return hasScoresRecord(v.first) || hasScoresRecord(v.second);
}

/** JSON 文字列 → id ごとのマップ（first または second のどちらかあれば採用） */
export function parseRawToDevScores(raw: string | null): DevScoresById {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, DevFiveScores>;
    const next: DevScoresById = {};
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k);
      if (!Number.isFinite(id) || !v || typeof v !== "object") continue;
      const row: DevFiveScores = {};
      if (hasScoresRecord(v.first)) row.first = v.first;
      if (hasScoresRecord(v.second)) row.second = v.second;
      if (hasAnyScores(row)) next[id] = row;
    }
    return next;
  } catch {
    return {};
  }
}

export function mergeDevScoresById(
  base: DevScoresById,
  incoming: DevScoresById
): DevScoresById {
  const out: DevScoresById = { ...base };
  const allIds = new Set([...Object.keys(out), ...Object.keys(incoming)]);
  for (const idStr of allIds) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    const prev = out[id];
    const inc = incoming[id];
    if (!inc && !prev) continue;
    const row: DevFiveScores = {};
    if (hasScoresRecord(inc?.first) || hasScoresRecord(prev?.first)) {
      row.first = hasScoresRecord(inc?.first) ? inc!.first! : prev!.first!;
    }
    if (hasScoresRecord(inc?.second) || hasScoresRecord(prev?.second)) {
      row.second = hasScoresRecord(inc?.second) ? inc!.second! : prev!.second!;
    }
    if (hasAnyScores(row)) out[id] = row;
    else delete out[id];
  }
  return out;
}

/** 本体とバックアップをマージして返す（どちらか欠けても復旧） */
export function loadDevScoresFromLocalStorage(key: string): DevScoresById {
  if (typeof window === "undefined") return {};
  const primary = parseRawToDevScores(window.localStorage.getItem(key));
  const backup = parseRawToDevScores(
    window.localStorage.getItem(backupKey(key))
  );
  return mergeDevScoresById(mergeDevScoresById({}, primary), backup);
}

/** 同一内容を本体＋バックアップの両方に保存（片方欠損対策） */
export function persistDevScoresToLocalStorage(key: string, data: DevScoresById) {
  if (typeof window === "undefined") return;
  try {
    const s = JSON.stringify(data);
    window.localStorage.setItem(key, s);
    window.localStorage.setItem(backupKey(key), s);
  } catch {
    try {
      window.localStorage.setItem(key, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }
}
