import type { DevFiveScores, DevScoresById } from "@/lib/dev-scores-local-storage";
import { hasAnyScores } from "@/lib/dev-scores-local-storage";

function hasScoreRecord(m: Record<string, number> | undefined): boolean {
  return Boolean(m && Object.keys(m).length > 0);
}

function normalizeScoreMap(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    out[k] = Math.max(0, Math.min(1, n));
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** DB / API からの jsonb を DevFiveScores に正規化 */
export function moderationDevScoresFromJsonb(
  value: unknown
): DevFiveScores | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const row: DevFiveScores = {};
  const first = normalizeScoreMap(o.first);
  const second = normalizeScoreMap(o.second);
  if (hasScoreRecord(first)) row.first = first;
  if (hasScoreRecord(second)) row.second = second;
  return hasAnyScores(row) ? row : null;
}

export function numericId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "bigint") return Number(raw);
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function buildDevScoresByIdFromRows(
  rows: ReadonlyArray<{ id: unknown; moderation_dev_scores?: unknown }>
): DevScoresById {
  const out: DevScoresById = {};
  for (const r of rows) {
    const id = numericId(r.id);
    if (id == null) continue;
    const parsed = moderationDevScoresFromJsonb(r.moderation_dev_scores);
    if (parsed) out[id] = parsed;
  }
  return out;
}

/** API / finalize で既存行に first / second をマージ */
export function mergeModerationDevScoresPatch(
  base: DevFiveScores | null,
  patch: { first?: Record<string, number>; second?: Record<string, number> }
): DevFiveScores | null {
  const row: DevFiveScores = { ...(base ?? {}) };
  if (patch.first !== undefined) {
    const n = normalizeScoreMap(patch.first);
    if (n) row.first = n;
    else delete row.first;
  }
  if (patch.second !== undefined) {
    const n = normalizeScoreMap(patch.second);
    if (n) row.second = n;
    else delete row.second;
  }
  return hasAnyScores(row) ? row : null;
}
