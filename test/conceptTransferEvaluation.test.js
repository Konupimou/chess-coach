import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  TRANSFER_CONCEPT_CATALOGUE,
  compareConceptFingerprints,
} from "../positionConcepts.js";
import { CONCEPT_TRANSFER_CASES } from "./fixtures/conceptTransferCases.js";

function fingerprint(testCase, { include = true, tacticalExtra = false } = {}) {
  const conceptIds = include ? [testCase.id] : [];
  const tacticalKeys = include && testCase.type === "tactical" ? [testCase.id] : [];
  if (tacticalExtra) tacticalKeys.push("loose_piece");
  return {
    version: 1,
    phase: testCase.id.includes("king") || testCase.id.includes("opposition") ? "endgame" : "middlegame",
    structuralKey: `structure:${testCase.id}`,
    pawnKey: `pawn:${testCase.id}`,
    materialKey: "material:equal",
    kingKey: "king:safe",
    conceptIds,
    tacticalKeys,
    concepts: include ? [{
      id: testCase.id,
      side: "w",
      prerequisites: testCase.prerequisites,
      typicalPlan: testCase.plan,
      counterplan: [`counter:${testCase.id}`],
      failureConditions: [testCase.failureCondition],
      criticalSquares: [],
      pawnBreaks: [],
      relevantPieces: [],
      confidence: 0.9,
      polarity: "positive",
    }] : [],
    summary: {},
  };
}

test("Transfer-Evaluation deckt alle geforderten Konzeptgruppen ab", () => {
  assert.deepEqual(
    CONCEPT_TRANSFER_CASES.map((entry) => entry.id),
    [...TRANSFER_CONCEPT_CATALOGUE],
  );
  assert.equal(CONCEPT_TRANSFER_CASES.length >= 25, true);
});

test("jede Konzeptgruppe akzeptiert das positive und verwirft das negative Beispiel", async (t) => {
  for (const testCase of CONCEPT_TRANSFER_CASES) {
    await t.test(testCase.id, () => {
      const known = fingerprint(testCase);
      const transferred = fingerprint(testCase);
      const negative = fingerprint(testCase, { include: false });
      const positiveMatch = compareConceptFingerprints(transferred, known);
      const negativeMatch = compareConceptFingerprints(negative, known);
      assert.equal(positiveMatch.transferableConcepts.some((entry) => entry.id === testCase.id), true);
      assert.equal(negativeMatch.transferableConcepts.length, 0);
    });
  }
});

test("strategisch passendes Konzept wird bei abweichender taktischer Realität blockiert", () => {
  const testCase = CONCEPT_TRANSFER_CASES.find((entry) => entry.type === "strategic");
  const query = fingerprint(testCase);
  const tacticalFailure = fingerprint(testCase, { tacticalExtra: true });
  const result = compareConceptFingerprints(query, tacticalFailure);
  assert.equal(result.tacticalMismatch, true);
  assert.equal(result.transferableConcepts.every((entry) => entry.blocked), true);
});

test("deterministische Transfer-Evaluation erreicht hohe Präzision und Recall", () => {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (const testCase of CONCEPT_TRANSFER_CASES) {
    const positive = compareConceptFingerprints(fingerprint(testCase), fingerprint(testCase));
    const negative = compareConceptFingerprints(
      fingerprint(testCase, { include: false }),
      fingerprint(testCase),
    );
    if (positive.transferableConcepts.some((entry) => entry.id === testCase.id)) truePositive += 1;
    else falseNegative += 1;
    if (negative.transferableConcepts.length > 0) falsePositive += 1;
  }
  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  assert.equal(precision, 1);
  assert.equal(recall, 1);
});

test("reine Konzeptsuche bleibt im Test deutlich unter dem 300-ms-Ziel", () => {
  const samples = CONCEPT_TRANSFER_CASES.map((testCase) => fingerprint(testCase));
  const durations = [];
  for (let index = 0; index < 500; index += 1) {
    const left = samples[index % samples.length];
    const right = samples[(index * 7) % samples.length];
    const start = performance.now();
    compareConceptFingerprints(left, right);
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  const p95 = durations[Math.floor(durations.length * 0.95)];
  assert.equal(p95 < 300, true);
});
