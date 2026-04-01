type AttributeName =
  | "TOXICITY"
  | "SEVERE_TOXICITY"
  | "INSULT"
  | "PROFANITY"
  | "THREAT";

export type ModerationScoreMap = Record<string, number>;

function clamp01(n: unknown) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function normalizeText(text: string) {
  return text.trim();
}

function mockScores(text: string) {
  const t = text.toLowerCase();
  const hits =
    (t.match(/死ね|殺|きも|バカ|ばか|クソ|くそ|カス|ボケ|アホ|fuck|shit|kill/g) ?? [])
      .length;
  const base = Math.min(1, hits / 3);
  return {
    TOXICITY: clamp01(base),
    SEVERE_TOXICITY: clamp01(base * 0.7),
    INSULT: clamp01(base * 0.9),
    PROFANITY: clamp01(base * 0.8),
    THREAT: clamp01(/殺|kill|die|死ね/.test(t) ? Math.max(base, 0.6) : base * 0.3),
  } satisfies Partial<Record<AttributeName, number>>;
}

async function analyzeWithPerspective(text: string) {
  const apiKey = process.env.PERSPECTIVE_API_KEY?.trim();
  if (!apiKey) return null;

  const url = `https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze?key=${encodeURIComponent(
    apiKey
  )}`;
  const requestedAttributes: Record<AttributeName, Record<string, never>> = {
    TOXICITY: {},
    SEVERE_TOXICITY: {},
    INSULT: {},
    PROFANITY: {},
    THREAT: {},
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      comment: { text },
      languages: ["ja"],
      requestedAttributes,
      doNotStore: true,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Perspective API error: ${res.status}`);

  const json = (await res.json()) as {
    attributeScores?: Partial<
      Record<
        AttributeName,
        {
          summaryScore?: {
            value?: number;
            score?: number;
          };
        }
      >
    >;
  };
  const scores: Partial<Record<AttributeName, number>> = {};
  for (const name of Object.keys(requestedAttributes) as AttributeName[]) {
    const v =
      json?.attributeScores?.[name]?.summaryScore?.value ??
      json?.attributeScores?.[name]?.summaryScore?.score ??
      null;
    if (v != null) scores[name] = clamp01(v);
  }
  return scores;
}

export async function scoreTextOverallMax(
  text: string,
  mode: "mock" | "perspective" = "perspective"
) {
  const res = await analyzeTextModeration(text, mode);
  return res.overallMax;
}

export async function analyzeTextModeration(
  text: string,
  mode: "mock" | "perspective" = "perspective"
): Promise<{ overallMax: number; scores: ModerationScoreMap }> {
  const normalized = normalizeText(text);
  if (!normalized) return { overallMax: 0, scores: {} };
  if (mode === "mock") {
    const scores = mockScores(normalized) as ModerationScoreMap;
    return {
      overallMax: Math.max(0, ...Object.values(scores).map((v) => v ?? 0)),
      scores,
    };
  }
  try {
    const scores = await analyzeWithPerspective(normalized);
    if (!scores) {
      const fallback = mockScores(normalized) as ModerationScoreMap;
      return {
        overallMax: Math.max(0, ...Object.values(fallback).map((v) => v ?? 0)),
        scores: fallback,
      };
    }
    return {
      overallMax: Math.max(0, ...Object.values(scores).map((v) => v ?? 0)),
      scores: scores as ModerationScoreMap,
    };
  } catch {
    const fallback = mockScores(normalized) as ModerationScoreMap;
    return {
      overallMax: Math.max(0, ...Object.values(fallback).map((v) => v ?? 0)),
      scores: fallback,
    };
  }
}
