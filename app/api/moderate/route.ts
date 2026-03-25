import { NextResponse } from "next/server";

type AttributeName =
  | "TOXICITY"
  | "SEVERE_TOXICITY"
  | "INSULT"
  | "PROFANITY"
  | "THREAT";

type ParagraphResult = {
  index: number;
  text: string;
  scores: Partial<Record<AttributeName, number>>;
  maxScore: number;
};

function clamp01(n: unknown) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function splitParagraphs(text: string) {
  return text
    .split(/\n{2,}/g)
    .map((t) => t.trim())
    .filter(Boolean);
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
      languages: ["ja", "en"],
      requestedAttributes,
      doNotStore: true,
    }),
    // avoid Next fetch caching surprises
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Perspective API error: ${res.status} ${res.statusText} ${body}`.trim()
    );
  }

  const json = (await res.json()) as any;
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

function mockScores(text: string) {
  // cheap, deterministic-ish heuristic for UI testing without API calls
  const t = text.toLowerCase();
  const hits =
    (t.match(/死ね|殺|きも|バカ|ばか|クソ|くそ|fuck|shit|kill|die/g) ?? []).length;
  const base = Math.min(1, hits / 3);
  return {
    TOXICITY: clamp01(base),
    SEVERE_TOXICITY: clamp01(base * 0.7),
    INSULT: clamp01(base * 0.9),
    PROFANITY: clamp01(base * 0.8),
    THREAT: clamp01(/殺|kill|die|死ね/.test(t) ? Math.max(base, 0.6) : base * 0.3),
  } satisfies Partial<Record<AttributeName, number>>;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | {
          text?: string;
          maxParagraphs?: number;
          mode?: "auto" | "mock" | "perspective";
        }
      | null;

    const text = body?.text ?? "";
    const maxParagraphs = Math.max(
      1,
      Math.min(20, Number(body?.maxParagraphs ?? 5))
    );
    const mode = body?.mode ?? "auto";

    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { error: "text is required" },
        { status: 400 }
      );
    }

    const paragraphs = splitParagraphs(text).slice(0, maxParagraphs);
    const results: ParagraphResult[] = [];

    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i]!;
      const scores =
        mode === "mock"
          ? mockScores(p)
          : mode === "perspective"
            ? await analyzeWithPerspective(p)
            : (await analyzeWithPerspective(p)) ?? mockScores(p);

      if (!scores) {
        // should be unreachable, but keep shape stable
        results.push({ index: i, text: p, scores: {}, maxScore: 0 });
        continue;
      }

      const maxScore = Math.max(0, ...Object.values(scores).map((v) => v ?? 0));
      results.push({ index: i, text: p, scores, maxScore });
    }

    const overallMax = Math.max(0, ...results.map((r) => r.maxScore));

    return NextResponse.json({
      mode:
        mode === "auto"
          ? process.env.PERSPECTIVE_API_KEY
            ? "perspective"
            : "mock"
          : mode,
      paragraphs: results,
      overallMax,
      truncated: splitParagraphs(text).length > paragraphs.length,
      attributes: [
        "TOXICITY",
        "SEVERE_TOXICITY",
        "INSULT",
        "PROFANITY",
        "THREAT",
      ] satisfies AttributeName[],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

