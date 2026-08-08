import { extractResponseText } from "./api/chat.js";

const OPENAI_URL = "https://api.openai.com/v1/responses";

export const BENCHMARK_JUDGE_SCHEMA = Object.freeze({
  type: "json_schema",
  name: "chess_coach_benchmark_judgment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      scores: {
        type: "object",
        additionalProperties: false,
        properties: {
          chessAccuracy: { type: "integer", minimum: 0, maximum: 10 },
          mainReason: { type: "integer", minimum: 0, maximum: 10 },
          specificity: { type: "integer", minimum: 0, maximum: 10 },
          clarity: { type: "integer", minimum: 0, maximum: 10 },
          teachingQuality: { type: "integer", minimum: 0, maximum: 10 },
          relevance: { type: "integer", minimum: 0, maximum: 10 },
        },
        required: [
          "chessAccuracy",
          "mainReason",
          "specificity",
          "clarity",
          "teachingQuality",
          "relevance",
        ],
      },
      hallucination: { type: "boolean" },
      majorChessError: { type: "boolean" },
      mainConceptFound: { type: "boolean" },
      contradictsEngine: { type: "boolean" },
      summary: { type: "string", maxLength: 600 },
    },
    required: [
      "scores",
      "hallucination",
      "majorChessError",
      "mainConceptFound",
      "contradictsEngine",
      "summary",
    ],
  },
});

function compactEvidence({ benchmarkCase, context, objective }) {
  const diagnosis = context?.diagnosis;
  const comparison = context?.positionEvidence?.moveComparison;
  return {
    fenBefore: benchmarkCase.fenBefore,
    playedMove: benchmarkCase.playedMove,
    engine: {
      bestMove: context?.engineContext?.bestMove || null,
      evaluation: context?.engineContext?.evaluation || null,
      lossCp: context?.engineContext?.moveReview?.lossCp ?? null,
      lines: (context?.engineContext?.lines || []).slice(0, 3).map((line) => ({
        evaluation: line.evaluation,
        pv: line.pv,
      })),
    },
    diagnosis: diagnosis ? {
      primaryReason: diagnosis.primaryReason,
      secondaryReasons: diagnosis.secondaryReasons,
      confidence: diagnosis.confidence,
      uncertainties: diagnosis.uncertainties,
    } : null,
    comparison: comparison ? {
      differences: comparison.differences,
      materialComparison: comparison.materialComparison,
      played: comparison.played,
      best: comparison.best,
    } : null,
    reviewedGroundTruth: benchmarkCase.expected?.needsReview
      ? null
      : {
        categories: benchmarkCase.expected?.categories || [],
        possibleConcepts: benchmarkCase.expected?.possibleConcepts || [],
        requiredFacts: benchmarkCase.expected?.requiredFacts || [],
      },
    deterministicFlags: objective.flags,
    deterministicIssues: objective.issues,
  };
}

function validJudgment(value) {
  if (!value || typeof value !== "object" || typeof value.summary !== "string") return false;
  const scores = value.scores;
  if (!scores || typeof scores !== "object") return false;
  return [
    "chessAccuracy",
    "mainReason",
    "specificity",
    "clarity",
    "teachingQuality",
    "relevance",
  ].every((key) => Number.isInteger(scores[key]) && scores[key] >= 0 && scores[key] <= 10);
}

export function createOpenAiBenchmarkJudge({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_EVAL_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY fehlt für den optionalen Benchmark-Judge.");
  if (typeof fetchImpl !== "function") throw new Error("fetch ist für den Benchmark-Judge nicht verfügbar.");
  return async ({ benchmarkCase, question, answer, context, objective }) => {
    const response = await fetchImpl(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: [
          "Du bewertest die Antwort eines Schachcoachs, nicht die Schönheit des Textes.",
          "Brettzustand, legal geprüfte Varianten und Stockfish-Daten haben höchste Autorität.",
          "Eine erwartete Konzeptliste ist nur dann Ground Truth, wenn reviewedGroundTruth nicht null ist.",
          "Bei needsReview darfst du kein Konzept allein wegen einer automatisch erzeugten Diagnose als wahr annehmen.",
          "Ein schwerer Schachfehler, eine erfundene Brettbehauptung oder ein Engine-Widerspruch muss chessAccuracy stark senken.",
          "Bewerte jede Kategorie unabhängig von 0 bis 10.",
        ].join("\n"),
        input: [
          `<user_question>\n${question.text}\n</user_question>`,
          `<coach_answer>\n${answer}\n</coach_answer>`,
          `<objective_evidence>\n${JSON.stringify(compactEvidence({ benchmarkCase, context, objective }))}\n</objective_evidence>`,
        ].join("\n\n"),
        reasoning: { effort: "low" },
        text: { format: BENCHMARK_JUDGE_SCHEMA },
        max_output_tokens: 900,
        store: false,
      }),
    });
    if (!response.ok) throw new Error(`Benchmark-Judge fehlgeschlagen (${response.status}).`);
    const data = await response.json();
    let parsed;
    try {
      parsed = JSON.parse(extractResponseText(data));
    } catch {
      throw new Error("Benchmark-Judge lieferte kein gültiges JSON.");
    }
    if (!validJudgment(parsed)) throw new Error("Benchmark-Judge verletzte das Bewertungsschema.");
    return parsed;
  };
}
