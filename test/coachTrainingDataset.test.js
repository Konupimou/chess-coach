import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCoachTrainingDataset,
  buildCoachTrainingExample,
  validateApprovedCoachTrainingRecord,
} from "../coachTrainingDataset.js";
import { seedCoachTrainingCandidates } from "../scripts/seed-coach-training-candidates.mjs";
import { COACH_EVALUATION_CASES } from "./fixtures/coachEvaluationCases.js";

const FAST_CASES = COACH_EVALUATION_CASES.slice(0, 20);

function approve(record, reviewer = "Chess Reviewer") {
  return {
    ...structuredClone(record),
    lifecycle: "human_approved",
    approval: {
      reviewer,
      reviewedAt: "2026-08-05T12:00:00.000Z",
    },
  };
}

test("generierte Coach-Texte werden nicht ohne menschliche Freigabe zu Trainingsdaten", () => {
  const [candidate] = seedCoachTrainingCandidates({ ratings: [800], cases: FAST_CASES });
  const result = validateApprovedCoachTrainingRecord(candidate);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /human_approved/.test(error)));
});

test("freigegebene Targets bleiben vollständig an Stockfish- und Brettbelege gebunden", () => {
  const [candidate] = seedCoachTrainingCandidates({ ratings: [1000], cases: FAST_CASES });
  const approved = approve(candidate);
  const valid = buildCoachTrainingExample(approved);
  assert.equal(valid.valid, true, valid.errors.join("\n"));
  assert.deepEqual(valid.value.messages.map((message) => message.role), [
    "system",
    "user",
    "assistant",
  ]);
  assert.doesNotMatch(JSON.stringify(valid.value.messages), /Chess Reviewer/u);

  const fabricated = structuredClone(approved);
  fabricated.target.verdict.text = "Die Bewertung springt hier sicher auf +99.00.";
  const invalid = buildCoachTrainingExample(fabricated);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => /target|Guard|Bewertung/iu.test(error)));
});

test("Train, Validation und Test bleiben nach Stellungsszenario leckagefrei", () => {
  const approved = seedCoachTrainingCandidates({ ratings: [800], cases: FAST_CASES })
    .slice(0, 20)
    .map((candidate) => approve(candidate));
  const dataset = buildCoachTrainingDataset(approved, { seed: "unit-test-seed" });
  assert.equal(dataset.valid, true, dataset.errors.join("\n"));
  assert.ok(dataset.splits.train.length > 0);
  assert.ok(dataset.splits.validation.length > 0);
  assert.ok(dataset.splits.test.length > 0);

  const groups = Object.fromEntries(Object.entries(dataset.splits).map(([split, items]) => [
    split,
    new Set(items.map((item) => item.groupKey)),
  ]));
  assert.equal([...groups.train].some((group) => groups.validation.has(group)), false);
  assert.equal([...groups.train].some((group) => groups.test.has(group)), false);
  assert.equal([...groups.validation].some((group) => groups.test.has(group)), false);
  assert.equal(dataset.manifest.counts.train, dataset.splits.train.length);
  assert.match(dataset.manifest.datasetHash, /^[a-f0-9]{64}$/u);
});

test("inhaltlich identische Beispiele werden nicht unter verschiedenen IDs vervielfacht", () => {
  const seeded = seedCoachTrainingCandidates({ ratings: [1400], cases: FAST_CASES });
  const [candidate] = seeded;
  const first = approve(candidate);
  const duplicate = {
    ...structuredClone(first),
    id: `${first.id}:copy`,
    groupKey: `${first.groupKey}:copy`,
  };
  const result = buildCoachTrainingDataset([
    first,
    duplicate,
    approve(seeded[1]),
    approve(seeded[2]),
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /inhaltlich identisch/.test(error)));
});
