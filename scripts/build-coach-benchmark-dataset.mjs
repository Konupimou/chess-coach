import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BENCHMARK_QUESTIONS,
  COACH_BENCHMARK_SCHEMA_VERSION,
  legalLineFromFen,
  validateBenchmarkDataset,
} from "../coachBenchmark.js";
import { COACH_EVALUATION_CASES } from "../test/fixtures/coachEvaluationCases.js";

const DEFAULT_OUTPUT = "data/benchmarks/coach-benchmark-v1.json";

const CONTROLLED_CASES = Object.freeze([
  ["tactic-mate-threat", ["TACTICAL", "KING_SAFETY", "MATING_ATTACK", "BLUNDER"], ["mating_attack"], "beginner"],
  ["tactic-hanging-queen", ["TACTICAL", "MATERIAL", "BLUNDER"], ["hanging_piece", "material_loss"], "beginner"],
  ["tactic-knight-fork", ["TACTICAL", "MATERIAL"], ["fork", "double_attack"], "beginner"],
  ["tactic-pin", ["TACTICAL"], ["pin"], "intermediate"],
  ["tactic-back-rank", ["TACTICAL", "KING_SAFETY", "MATING_ATTACK"], ["back_rank_mate", "mating_attack"], "beginner"],
  ["strategy-missed-castle", ["KING_SAFETY", "DEVELOPMENT", "MULTI_FACTOR"], ["discovered_attack", "king_safety"], "intermediate"],
  ["strategy-prophylaxis", ["POSITIONAL", "QUIET_MOVE"], ["prophylaxis"], "advanced"],
  ["strategy-pawn-break", ["POSITIONAL", "PAWN_STRUCTURE", "QUIET_MOVE"], ["pawn_break"], "intermediate"],
  ["strategy-outpost", ["POSITIONAL", "PIECE_ACTIVITY", "QUIET_MOVE"], ["outpost"], "intermediate"],
  ["strategy-open-file-rook", ["POSITIONAL", "PIECE_ACTIVITY", "QUIET_MOVE"], ["rook_on_open_file", "open_file"], "intermediate"],
  ["endgame-king-centralization", ["ENDGAME", "PIECE_ACTIVITY", "QUIET_MOVE"], ["king_activity_endgame"], "beginner"],
  ["endgame-passed-pawn", ["ENDGAME", "PAWN_STRUCTURE"], ["passed_pawn"], "beginner"],
  ["opening-poor-development", ["DEVELOPMENT", "POSITIONAL", "QUIET_MOVE"], ["development_advantage"], "beginner"],
  ["tactic-zwischenzug", ["TACTICAL", "MATERIAL"], ["zwischenzug"], "advanced"],
  ["exchange-unfavorable", ["MATERIAL", "TACTICAL"], ["hanging_piece", "material_loss", "unfavorable_exchange"], "intermediate"],
  ["quiet-best-without-tactic", ["QUIET_MOVE", "POSITIONAL"], [], "advanced"],
  ["quiet-no-reliable-motif", ["QUIET_MOVE", "UNCERTAIN"], [], "advanced", true],
  ["plausible-idea-bad-result", ["MATERIAL", "BLUNDER", "MULTI_FACTOR"], ["hanging_piece", "material_loss"], "intermediate"],
]);

function option(argv, name, fallback = "") {
  const prefix = `--${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function controlledCase([id, categories, possibleConcepts, difficulty, expectNoPrimaryReason = false]) {
  const fixture = COACH_EVALUATION_CASES.find((entry) => entry.id === id);
  if (!fixture) throw new Error(`Kuratierter Benchmarkfall fehlt: ${id}`);
  const after = legalLineFromFen(fixture.fen, [fixture.playedMove]);
  const bestMove = fixture.candidateLines[0]?.pvUci?.[0] || fixture.playedMove;
  const bestValue = fixture.candidateLines[0]?.evaluation?.value;
  const playedValue = fixture.playedLine?.evaluation?.value;
  const lossCp = Number.isFinite(bestValue) && Number.isFinite(playedValue)
    ? Math.max(0, bestValue - playedValue)
    : 0;
  const isGood = ["best", "excellent", "good"].includes(fixture.expectedQuality);
  return {
    id: `controlled-${id}`,
    fenBefore: fixture.fen,
    fenAfter: after.fenAfter,
    playedMove: { uci: fixture.playedMove, san: fixture.playedSan },
    engine: {
      provider: "stockfish_fixture",
      depth: 18,
      bestMove,
      lossCp,
      quality: fixture.expectedQuality,
      lines: fixture.candidateLines.map((line) => ({
        rank: line.rank,
        depth: 18,
        evaluation: line.evaluation,
        pvUci: line.pvUci,
      })),
      playedLine: {
        depth: 18,
        evaluation: fixture.playedLine.evaluation,
        pvUci: fixture.playedLine.pvUci,
      },
      onlyMove: fixture.legalMoveCount === 1,
      onlyMoveEvidence: fixture.legalMoveCount === 1
        ? { type: "only_legal_move", legalMoveCount: 1 }
        : null,
    },
    expected: {
      categories,
      possibleConcepts,
      requiredFacts: fixture.requiredFacts,
      needsReview: false,
      expectNoPrimaryReason,
      groundTruth: "curated_legal_fixture",
    },
    source: { type: "controlled", fixtureId: fixture.id },
    difficulty,
    questionIds: isGood
      ? ["why_best", "why_evaluation", "most_important"]
      : ["why_bad", "overlooked", "compare", "lesson", "was_bad"],
    metadata: { generated: false, rating: difficulty === "beginner" ? 800 : difficulty === "intermediate" ? 1400 : 1800 },
  };
}

export async function buildCoachBenchmarkDataset({ output = DEFAULT_OUTPUT, pgnCandidates = "" } = {}) {
  const controlled = CONTROLLED_CASES.map(controlledCase);
  let pgn = [];
  if (pgnCandidates) {
    const source = JSON.parse(await readFile(resolve(pgnCandidates), "utf8"));
    pgn = Array.isArray(source?.cases) ? source.cases : [];
  }
  const dataset = {
    schemaVersion: COACH_BENCHMARK_SCHEMA_VERSION,
    datasetId: "coach-benchmark-v1",
    description: "Stabiler MVP-Benchmark aus kuratierten und PGN-basierten Stellungen.",
    contaminationPolicy: "Erwartungen und Labels sind ausschließlich für den Runner bestimmt und werden nie in Coach-Prompts eingefügt.",
    questions: BENCHMARK_QUESTIONS,
    cases: [...controlled, ...pgn],
  };
  const validation = validateBenchmarkDataset(dataset);
  if (!validation.valid) throw new Error(`Benchmarkdatensatz ist ungültig:\n${validation.errors.join("\n")}`);
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  return { dataset, output: target, controlled: controlled.length, pgn: pgn.length };
}

async function main() {
  const argv = process.argv.slice(2);
  const result = await buildCoachBenchmarkDataset({
    output: option(argv, "output", DEFAULT_OUTPUT),
    pgnCandidates: option(argv, "pgn", ""),
  });
  process.stdout.write(`Benchmark gespeichert: ${result.output}\n`);
  process.stdout.write(`Fälle: ${result.dataset.cases.length} (${result.controlled} kontrolliert, ${result.pgn} PGN)\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
