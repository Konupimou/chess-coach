import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  BENCHMARK_QUESTIONS,
  benchmarkContextForCase,
  benchmarkFingerprint,
  calibrationMetrics,
  compareBenchmarkRuns,
  evaluateBenchmarkAnswer,
  runBenchmarkCase,
  summarizeBenchmarkResults,
  validateBenchmarkDataset,
} from "../coachBenchmark.js";
import { createOpenAiBenchmarkJudge } from "../coachBenchmarkJudge.js";
import { moveExplanationToMarkdown } from "../coachExplanation.js";
import {
  benchmarkCaseFromPgnAnalysis,
  pgnCandidateMoves,
  splitPgnGames,
} from "../scripts/generate-pgn-benchmark-candidates.mjs";
import {
  benchmarkReportMarkdown,
  selectBenchmarkWork,
} from "../scripts/run-coach-benchmark.mjs";
import { parseAnnotatedPgn } from "../pgnPipeline.js";

const v1Raw = await readFile(
  new URL("../data/benchmarks/coach-benchmark-v1.json", import.meta.url),
  "utf8",
);
const dataset = JSON.parse(v1Raw);
const v2Dataset = JSON.parse(await readFile(
  new URL("../data/benchmarks/coach-benchmark-v2.json", import.meta.url),
  "utf8",
));

test("Benchmarkdatensatz ist stabil, gemischt und frei von Musterantworten", () => {
  const validation = validateBenchmarkDataset(dataset);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.valid, true);
  assert.ok(dataset.cases.length >= 20 && dataset.cases.length <= 25);
  assert.ok(dataset.cases.some((entry) => entry.source.type === "controlled"));
  assert.ok(dataset.cases.some((entry) => entry.source.type === "pgn"));
  assert.ok(dataset.cases.filter((entry) => entry.source.type === "pgn").every(
    (entry) => entry.expected.needsReview === true,
  ));
  assert.equal(JSON.stringify(dataset.cases.map((entry) => entry.expected)).includes('"answer"'), false);
  assert.equal(JSON.stringify(dataset.cases.map((entry) => entry.expected)).includes('"explanation"'), false);
});

test("v1 bleibt unverändert und v2 ist eine getrennte schwierige Multi-Factor-Suite", () => {
  assert.equal(
    createHash("sha256").update(v1Raw).digest("hex"),
    "ace2af058eb0077373db85e782bfb415e0a34e3a6dc33b4502df7528add6d466",
  );
  const validation = validateBenchmarkDataset(v2Dataset);
  assert.deepEqual(validation.errors, []);
  assert.equal(v2Dataset.datasetId, "coach-benchmark-v2-hard");
  assert.equal(
    benchmarkFingerprint(v2Dataset),
    "4e3cb42298d7f28976c877c1ba7ad0c19b0a02e6dc636ddaa4cbc85ed65cb6ba",
  );
  assert.equal(v2Dataset.cases.length, 25);
  assert.ok(v2Dataset.cases.every((entry) => entry.difficulty === "advanced"));
  assert.ok(v2Dataset.cases.every((entry) => entry.source.type === "curated_pgn"));
  assert.ok(v2Dataset.cases.every((entry) => entry.expected.reasonMode === "multi_factor"));
  assert.ok(v2Dataset.cases.every(
    (entry) => entry.expected.requiredConceptGroups.length >= 2,
  ));
  assert.ok(v2Dataset.cases.every((entry) => (
    entry.engine.playedLine.rank === entry.engine.lines.find(
      (line) => line.pvUci[0] === entry.playedMove.uci,
    )?.rank
  )));
  const categories = new Set(v2Dataset.cases.flatMap((entry) => entry.expected.categories));
  for (const category of ["MULTI_FACTOR", "QUIET_MOVE", "PROPHYLAXIS", "COMPENSATION", "INITIATIVE", "COMPLEX_ENDGAME", "UNCERTAIN"]) {
    assert.ok(categories.has(category), category);
  }
  const v1Ids = new Set(dataset.cases.map((entry) => entry.id));
  assert.ok(v2Dataset.cases.every((entry) => !v1Ids.has(entry.id)));
});

test("v2 trennt taktische Features von kausal validierten strategischen Gründen", () => {
  const expectedPrimary = new Map([
    ["v2-quiet-weak-square-prophylaxis", "prophylaxis"],
    ["v2-active-prophylaxis-queen-retreat", "prophylaxis"],
    ["v2-aggressive-prophylaxis-qh8", "initiative"],
    ["v2-initiative-forcing-knight", "initiative"],
    ["v2-compensation-development-tempi", "compensation"],
    ["v2-compensation-center-and-attack", "compensation"],
    ["v2-compensation-hindrance-pawn", "compensation"],
    ["v2-compensation-queen-sacrifice", "compensation"],
    ["v2-initiative-restricting-sacrifice", "compensation"],
    ["v2-initiative-quiet-pawn", "initiative"],
  ]);
  for (const [caseId, concept] of expectedPrimary) {
    const benchmarkCase = v2Dataset.cases.find((entry) => entry.id === caseId);
    const diagnosis = benchmarkContextForCase(benchmarkCase).diagnosis;
    assert.equal(diagnosis.primaryReason?.concept, concept, caseId);
    assert.equal(diagnosis.primaryReason?.kind, "candidate_explanation", caseId);
    assert.equal(diagnosis.primaryReason?.causalValidation?.status, "validated", caseId);
  }

  const initiative = benchmarkContextForCase(v2Dataset.cases.find(
    (entry) => entry.id === "v2-initiative-forcing-knight",
  )).diagnosis;
  const displacedFork = initiative.detectedFeatures.find(
    (entry) => entry.concept === "fork",
  );
  assert.equal(displacedFork?.causalValidation?.status, "supporting_only");
  assert.ok(initiative.causalValidation.supportingOnly > 0);
});

test("v2 bewertet Diagnose- und Erklärungsfaktoren getrennt", () => {
  const benchmarkCase = v2Dataset.cases.find(
    (entry) => entry.id === "v2-compensation-development-tempi",
  );
  const context = benchmarkContextForCase(benchmarkCase);
  const objective = evaluateBenchmarkAnswer({
    benchmarkCase,
    question: BENCHMARK_QUESTIONS.find((entry) => entry.id === "why_best"),
    answer: "Der Zug entwickelt eine Figur und verbessert ihre Aktivität.",
    context,
  });
  assert.ok(Number.isFinite(objective.metrics.diagnosisFactorCoverage));
  assert.ok(Number.isFinite(objective.metrics.answerFactorCoverage));
  assert.ok(objective.metrics.answerFactorCoverage < 100);
  assert.ok(objective.issues.some((issue) => issue.startsWith("missing_explanation_factor:")));
});

test("Benchmark verwendet dieselbe Evidenz-, Muster- und Diagnosepipeline wie der Coach", () => {
  const benchmarkCase = dataset.cases.find((entry) => entry.id === "controlled-tactic-hanging-queen");
  const context = benchmarkContextForCase(benchmarkCase, { rating: 1000 });
  assert.equal(context.positionEvidence.valid, true);
  assert.ok(context.positionEvidence.verifiedLines.every((line) => line.legal && line.complete));
  assert.equal(context.engineContext.bestMove.uci, benchmarkCase.engine.bestMove);
  assert.equal(context.diagnosis.primaryReason.concept, "hanging_piece");
  assert.ok(context.recognizedPatterns.length > 0);
});

test("der sichtbare Coach beginnt mit dem diagnostizierten Hauptgrund", () => {
  const expectations = [
    ["controlled-tactic-mate-threat", /Mattgefahr/iu],
    ["controlled-tactic-knight-fork", /Gabel/iu],
    ["controlled-tactic-pin", /Fesselung/iu],
    ["controlled-strategy-prophylaxis", /Prophylaxe/iu],
    ["controlled-strategy-pawn-break", /Bauernhebel/iu],
    ["controlled-strategy-outpost", /Vorposten/iu],
    ["controlled-endgame-passed-pawn", /Freibauer/iu],
    ["controlled-opening-poor-development", /Entwicklung/iu],
    ["controlled-tactic-zwischenzug", /Zwischenzug/iu],
  ];
  for (const [caseId, pattern] of expectations) {
    const benchmarkCase = dataset.cases.find((entry) => entry.id === caseId);
    const context = benchmarkContextForCase(benchmarkCase);
    const answer = moveExplanationToMarkdown(context.localExplanation, { deep: true });
    assert.match(answer, pattern, caseId);
    assert.match(answer.split("\n\n")[0], /Hauptgrund/iu, caseId);
  }

  const quiet = dataset.cases.find(
    (entry) => entry.id === "controlled-quiet-no-reliable-motif",
  );
  const quietAnswer = moveExplanationToMarkdown(
    benchmarkContextForCase(quiet).localExplanation,
    { deep: true },
  );
  assert.match(quietAnswer, /nicht sicher belegt/iu);
});

test("kausal validierte v2-Diagnosen werden als Multi-Factor-Erklärung mit Engine-Evidenz sichtbar", () => {
  const expectations = [
    {
      id: "v2-compensation-development-tempi",
      cause: /Kompensation ist der Hauptgrund/iu,
      support: /Initiative/iu,
      evidence: /Engine|Hauptvariante|MultiPV|Vorher-\/Nachher/iu,
    },
    {
      id: "v2-aggressive-prophylaxis-qh8",
      cause: /Initiative ist der Hauptgrund/iu,
      support: /Figurenaktivität/iu,
      evidence: /Engine|Hauptvariante|MultiPV|Vorher-\/Nachher/iu,
    },
    {
      id: "v2-active-prophylaxis-queen-retreat",
      cause: /Hauptgrund ist Prophylaxe/iu,
      support: /Initiative/iu,
      evidence: /Engine|Hauptvariante|MultiPV|Vorher-\/Nachher/iu,
    },
  ];
  for (const expectation of expectations) {
    const benchmarkCase = v2Dataset.cases.find((entry) => entry.id === expectation.id);
    const context = benchmarkContextForCase(benchmarkCase);
    const answer = moveExplanationToMarkdown(context.localExplanation, { deep: true });
    assert.match(answer, expectation.cause, expectation.id);
    assert.match(answer, expectation.support, expectation.id);
    assert.match(answer, expectation.evidence, expectation.id);
    assert.equal(context.diagnosis.primaryReason.causalValidation.status, "validated");
  }
});

test("Endspiel-Königsaktivität wird sichtbar vor Zentrumskontrolle erklärt", () => {
  const benchmarkCase = dataset.cases.find(
    (entry) => entry.id === "controlled-endgame-king-centralization",
  );
  const context = benchmarkContextForCase(benchmarkCase);
  const answer = moveExplanationToMarkdown(context.localExplanation, { deep: true });
  assert.equal(context.diagnosis.primaryReason.concept, "king_activity_endgame");
  assert.match(answer, /Königsaktivität.{0,50}Hauptgrund/iu);
});

test("objektive Halluzinationen und Engine-Widersprüche deckeln den Score hart", () => {
  const benchmarkCase = dataset.cases.find((entry) => entry.id === "controlled-tactic-hanging-queen");
  const context = benchmarkContextForCase(benchmarkCase);
  const objective = evaluateBenchmarkAnswer({
    benchmarkCase,
    question: BENCHMARK_QUESTIONS[0],
    answer: "Nach a1a8 steht der schwarze König matt und dein Läufer auf g5 hängt.",
    context,
  });
  assert.equal(objective.flags.hallucination, true);
  assert.equal(objective.flags.majorChessError, true);
  assert.ok(objective.score <= 35);
  assert.ok(objective.issues.some((issue) => issue.startsWith("unsupported_move:")));
});

test("lokaler Benchmarklauf erzeugt getrennte objektive Metriken und Fehleranalyse", async () => {
  const benchmarkCase = dataset.cases.find((entry) => entry.id === "controlled-tactic-mate-threat");
  const result = await runBenchmarkCase(
    benchmarkCase,
    BENCHMARK_QUESTIONS.find((entry) => entry.id === "why_bad"),
  );
  assert.equal(result.coachSource, "local");
  assert.ok(result.answer.length > 0);
  assert.equal(result.objective.metrics.moveLegality, 100);
  assert.equal(result.objective.metrics.evidenceIntegrity, 100);
  assert.equal(result.objective.flags.hallucination, false);
  const summary = summarizeBenchmarkResults([result]);
  assert.equal(summary.overall.cases, 1);
  assert.equal(result.objective.flags.mainConceptFound, true);
  assert.equal(summary.topFailures.length, 0);
});

test("Konfidenzkalibrierung bestraft selbstsicher falsche Diagnosen", () => {
  const make = (caseId, confidence, correct, calibrationClass) => ({
    caseId,
    objective: { diagnosis: { confidence, correct, calibrationClass } },
  });
  const metrics = calibrationMetrics([
    make("a", 0.9, false, "confident_wrong"),
    make("b", 0.8, true, "confident_correct"),
    make("c", 0.3, true, "uncertain_correct"),
  ]);
  assert.equal(metrics.evaluated, 3);
  assert.equal(metrics.confidentlyWrong, 1);
  assert.ok(metrics.brierScore > 0);
  assert.ok(metrics.expectedCalibrationError > 0);
});

test("Run-Vergleich findet Kategorieverschiebungen und konkrete Regressionen", () => {
  const result = (score) => ({
    caseId: "case-1",
    questionId: "why_bad",
    score,
    categories: ["TACTICAL"],
    difficulty: "beginner",
    source: { type: "controlled" },
    objective: {
      score,
      metrics: { moveLegality: 100, evidenceIntegrity: 100, engineConsistency: 100, noHallucination: 100 },
      flags: { hallucination: false, majorChessError: false, mainConceptFound: true },
      diagnosis: { correct: true, confidence: 0.8, calibrationClass: "confident_correct" },
      issues: [],
    },
    answer: "Konkrete Erklärung.",
  });
  const baseline = { runId: "before", results: [result(90)] };
  baseline.summary = summarizeBenchmarkResults(baseline.results);
  const current = { runId: "after", results: [result(70)] };
  current.summary = summarizeBenchmarkResults(current.results);
  const comparison = compareBenchmarkRuns(current, baseline);
  assert.equal(comparison.overallDelta, -20);
  assert.equal(comparison.categoryDeltas.TACTICAL, -20);
  assert.equal(comparison.regressions.length, 1);
  assert.equal(compareBenchmarkRuns(
    { ...current, datasetId: "v2" },
    { ...baseline, datasetId: "v1" },
  ), null);
});

test("Quick-, Full-, Kategorie- und Fehlerfilter wählen reproduzierbare Arbeit", () => {
  const quick = selectBenchmarkWork(dataset);
  const full = selectBenchmarkWork(dataset, { full: true });
  const tactical = selectBenchmarkWork(dataset, { category: "tactics" });
  const failureId = dataset.cases[0].id;
  const failures = selectBenchmarkWork(dataset, { failureIds: new Set([failureId]) });
  assert.equal(quick.length, dataset.cases.length);
  assert.ok(full.length > quick.length);
  assert.ok(tactical.every((entry) => entry.benchmarkCase.expected.categories.includes("TACTICAL")));
  assert.ok(failures.every((entry) => entry.benchmarkCase.id === failureId));
});

test("PGN-Generator zerlegt Partien, priorisiert Kommentare und anonymisiert den Fall", () => {
  const raw = [
    '[Event "One"]\n[Result "*"]\n\n1. e4 {A strong central move.} e5 *',
    '[Event "Two"]\n[Result "*"]\n\n1. d4 {A positional move.} d5 *',
  ].join("\n\n");
  const games = splitPgnGames(raw);
  assert.equal(games.length, 2);
  const parsed = parseAnnotatedPgn(games[0], { source: "test-source", gameOrdinal: 1 });
  const moves = pgnCandidateMoves(parsed);
  assert.equal(moves[0].uci, "e2e4");
  const benchmarkCase = benchmarkCaseFromPgnAnalysis({
    parsedGame: parsed,
    move: moves[0],
    sourceName: "private-game.pgn",
    depth: 8,
    lines: [
      { rank: 1, depth: 8, uci: "e2e4", evaluation: { unit: "cp", value: 30, perspective: "player" }, pvUci: ["e2e4", "e7e5"] },
      { rank: 2, depth: 8, uci: "d2d4", evaluation: { unit: "cp", value: 20, perspective: "player" }, pvUci: ["d2d4", "d7d5"] },
    ],
  });
  assert.equal(benchmarkCase.source.type, "pgn");
  assert.equal(benchmarkCase.expected.needsReview, true);
  assert.equal("white" in benchmarkCase.metadata, false);
  assert.equal(JSON.stringify(benchmarkCase).includes("private-game.pgn"), false);
});

test("optionaler Judge nutzt Structured Outputs, keine Speicherung und wird lokal validiert", async () => {
  let request = null;
  const judge = createOpenAiBenchmarkJudge({
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
            scores: { chessAccuracy: 9, mainReason: 8, specificity: 8, clarity: 9, teachingQuality: 8, relevance: 9 },
            hallucination: false,
            majorChessError: false,
            mainConceptFound: true,
            contradictsEngine: false,
            summary: "Belegt und relevant.",
          }) }] }] };
        },
      };
    },
  });
  const benchmarkCase = dataset.cases[0];
  const context = benchmarkContextForCase(benchmarkCase);
  const judgment = await judge({
    benchmarkCase,
    question: BENCHMARK_QUESTIONS[0],
    answer: "Die Mattdrohung entscheidet.",
    context,
    objective: { flags: {}, issues: [] },
  });
  assert.equal(judgment.scores.chessAccuracy, 9);
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
});

test("Markdownreport zeigt Score, Kalibrierung, Fehler und Regressionen", () => {
  const benchmarkCase = dataset.cases[0];
  const fakeResult = {
    caseId: benchmarkCase.id,
    questionId: "why_bad",
    score: 50,
    categories: benchmarkCase.expected.categories,
    expectedConcepts: benchmarkCase.expected.possibleConcepts,
    difficulty: benchmarkCase.difficulty,
    source: benchmarkCase.source,
    needsReview: false,
    answer: "Testantwort",
    objective: {
      score: 50,
      metrics: { moveLegality: 100, evidenceIntegrity: 100, engineConsistency: 100, noHallucination: 100 },
      flags: { hallucination: false, majorChessError: false, mainConceptFound: false },
      diagnosis: { concept: "pin", correct: false, confidence: 0.9, calibrationClass: "confident_wrong" },
      issues: ["wrong_primary_reason:pin"],
    },
  };
  const run = {
    runId: "test-run",
    datasetId: dataset.datasetId,
    config: { coachMode: "local", judge: false },
    results: [fakeResult],
    summary: summarizeBenchmarkResults([fakeResult]),
    comparison: { overallDelta: -5, metricDeltas: { chessAccuracy: 0, mainReasonPercent: -10, hallucinationRate: 0 }, categoryDeltas: {}, regressions: [], improvements: [] },
  };
  const markdown = benchmarkReportMarkdown(run);
  assert.match(markdown, /Chess Coach Benchmark/);
  assert.match(markdown, /Kalibrierung/);
  assert.match(markdown, /wrong_primary_reason:pin/);
  assert.match(markdown, /Regressionen/);
});
