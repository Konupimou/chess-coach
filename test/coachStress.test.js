import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  coachStressReportMarkdown,
  generateRandomPositionSample,
} from "../scripts/stress-test-coach-games.mjs";

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
    issueCounts: { language: {}, semantics: {} },
    failureExamples: [],
    durationSeconds: 0.1,
  };
  const markdown = coachStressReportMarkdown(result);

  assert.match(markdown, /Unbelegte Brettbehauptung \| 0/);
  assert.match(markdown, /Unbelegte Bewertungszahl \| 0/);
  assert.match(markdown, /keine Rohpartien/iu);
});
