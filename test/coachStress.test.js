import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  coachStressReportMarkdown,
  generateRandomPositionSample,
} from "../scripts/stress-test-coach-games.mjs";
import { combinedAuditMarkdown } from "../scripts/audit-coach-800.mjs";

test("der Zufallspartie-Stresstest wählt deterministisch nur legale Züge", () => {
  const options = {
    games: 8,
    positionsPerPhase: 1,
    maxPlies: 80,
    seed: "coach-stress-regression",
  };
  const first = generateRandomPositionSample(options);
  const second = generateRandomPositionSample(options);

  assert.equal(first.summary.selectionHash, second.summary.selectionHash);
  assert.deepEqual(first.selected, second.selected);
  assert.ok(first.summary.generatedPlies > 0);
  assert.equal(first.selected.length, 3);
  first.selected.forEach((sample) => {
    const game = new Chess(sample.fen);
    const legal = game.moves({ verbose: true }).some((move) => (
      `${move.from}${move.to}${move.promotion || ""}` === sample.playedUci
    ));
    assert.equal(legal, true, `${sample.playedUci} muss in der gewählten FEN legal sein`);
  });
});

test("der 800-Elo-Audit kann wirklich jeden Halbzug einer Partie auswählen", () => {
  const result = generateRandomPositionSample({
    games: 3,
    maxPlies: 20,
    seed: "coach-audit-800-regression",
    everyPly: true,
  });

  assert.equal(result.summary.everyPly, true);
  assert.equal(result.selected.length, result.summary.generatedPlies);
  assert.equal(
    result.summary.coverage.reduce((sum, row) => sum + row.selectedPositions, 0),
    result.summary.generatedPlies,
  );
});

test("der Stressbericht führt Brett- und Bewertungswächter getrennt auf", () => {
  const group = {
    evaluated: 1,
    passed: 1,
    failed: 0,
    passPercent: 100,
    maximumSentences: 2,
  };
  const result = {
    gates: {
      releaseReady: true,
      note: "Ein endlicher Test bleibt begrenzt.",
    },
    generation: {
      gamesGenerated: 1,
      generatedPlies: 8,
      selectionHash: "abc",
      coverage: [{
        phase: "opening",
        gamesReachingPhase: 1,
        availableUniquePositions: 1,
        requestedPositions: 1,
        selectedPositions: 1,
      }],
    },
    totals: {
      analyzedPositions: 1,
      outputs: 1,
      passedOutputs: 1,
      passPercent: 100,
      evidenceFailures: 0,
      nullExplanations: 0,
      verificationFailures: 0,
      languageFailures: 0,
      semanticFailures: 0,
      completenessFailures: 0,
      unsupportedMoveFailures: 0,
      unsupportedBoardClaimFailures: 0,
      unsupportedEvaluationFailures: 0,
      phaseMismatches: 0,
    },
    engine: {
      name: "Stockfish Test",
      limit: { value: 1 },
      multiPv: 2,
    },
    byRating: { 800: group },
    byPhase: { opening: group },
    issueCounts: { language: {}, semantics: {}, completeness: {} },
    failureExamples: [],
    positiveExamples: [{
      move: "e4",
      phase: "opening",
      rating: 800,
      quality: "best",
      lossCp: 0,
      fen: new Chess().fen(),
      text: "e4 besetzt das Zentrum.",
    }],
    config: { selectedRatings: [800], everyPly: true },
    durationSeconds: 0.1,
  };
  const markdown = coachStressReportMarkdown(result);

  assert.match(markdown, /Unbelegte Brettbehauptung \| 0/);
  assert.match(markdown, /Unbelegte Bewertungszahl \| 0/);
  assert.match(markdown, /keine Rohpartien/iu);
  assert.match(markdown, /jeden erzeugten Halbzug/);
  assert.match(markdown, /Besonders gute Erklärungen/);
  assert.match(markdown, /e4 besetzt das Zentrum/);
});

test("der kombinierte 800-Elo-Bericht trennt Vollprüfung und tiefe Gegenprüfung", () => {
  const audit = {
    passed: true,
    games: 200,
    checkedReports: 200,
    checkedMoves: 12_000,
    checkedTexts: 30_000,
    output: "",
  };
  const deep = {
    generation: { gamesGenerated: 200 },
    totals: { analyzedPositions: 225, selectedPositions: 225, outputs: 225, passedOutputs: 225, failedOutputs: 0 },
  };
  const reportStub = (base) => ({
    ...base,
    gates: { releaseReady: true, note: "Begrenzt." },
    engine: { name: "Stockfish", limit: { value: 1 }, multiPv: 2 },
    byRating: {},
    byPhase: {},
    issueCounts: { language: {}, semantics: {} },
    failureExamples: [],
    positiveExamples: [],
    config: { selectedRatings: [800], everyPly: true },
    durationSeconds: 1,
    generation: {
      generatedPlies: base.totals.analyzedPositions,
      selectionHash: "abc",
      coverage: [],
      ...base.generation,
    },
    totals: {
      evidenceFailures: 0,
      nullExplanations: 0,
      verificationFailures: 0,
      languageFailures: 0,
      semanticFailures: 0,
      completenessFailures: 0,
      unsupportedMoveFailures: 0,
      unsupportedBoardClaimFailures: 0,
      unsupportedEvaluationFailures: 0,
      phaseMismatches: 0,
      passPercent: 100,
      ...base.totals,
    },
  });
  const markdown = combinedAuditMarkdown({
    fullAudit: audit,
    deepAudit: reportStub(deep),
  });

  assert.match(markdown, /200 reproduzierbaren/);
  assert.match(markdown, /Teil 1: Jeder Halbzug/);
  assert.match(markdown, /Teil 2: Tiefere Gegenprüfung/);
  assert.match(markdown, /12\.000/);
});
