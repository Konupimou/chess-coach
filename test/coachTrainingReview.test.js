import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCoachTrainingTextEdits,
  buildApprovedCoachTrainingRecord,
  coachTrainingReviewEntry,
} from "../coachTrainingReview.js";
import { seedCoachTrainingCandidates } from "../scripts/seed-coach-training-candidates.mjs";
import { COACH_EVALUATION_CASES } from "./fixtures/coachEvaluationCases.js";

function candidateForReview() {
  return seedCoachTrainingCandidates({
    ratings: [800],
    cases: COACH_EVALUATION_CASES.slice(0, 3),
  })[0];
}

test("die Review-Oberfläche kann ausschließlich vorhandene Textfelder verändern", () => {
  const candidate = candidateForReview();
  const target = applyCoachTrainingTextEdits(candidate, {
    verdict: candidate.target.verdict.text,
    moveIdea: "Kurz und verständlich erklärt.",
    inventedField: "darf nicht hinein",
  });

  assert.equal(target.moveIdea.text, "Kurz und verständlich erklärt.");
  assert.equal("inventedField" in target, false);
  assert.deepEqual(target.moveIdea.evidenceIds, candidate.target.moveIdea.evidenceIds);
  assert.deepEqual(target.moveIdea.moveRefs, candidate.target.moveIdea.moveRefs);
  assert.equal(target.subjectUci, candidate.target.subjectUci);
  assert.equal(candidate.target.moveIdea.text === target.moveIdea.text, false);
});

test("eine Freigabe wird erst nach der vollständigen Guard-Prüfung erzeugt", () => {
  const candidate = candidateForReview();
  const approved = buildApprovedCoachTrainingRecord(candidate, {
    reviewer: "PP",
    reviewedAt: "2026-08-05T20:00:00.000Z",
    textEdits: {
      verdict: candidate.target.verdict.text,
      moveIdea: candidate.target.moveIdea.text,
    },
  });

  assert.equal(approved.valid, true, approved.errors.join("\n"));
  assert.equal(approved.record.lifecycle, "human_approved");
  assert.equal(approved.record.approval.reviewer, "PP");

  const fabricated = buildApprovedCoachTrainingRecord(candidate, {
    reviewer: "PP",
    reviewedAt: "2026-08-05T20:00:00.000Z",
    textEdits: { verdict: "Der Zug gewinnt sicher eine Dame auf h8." },
  });
  assert.equal(fabricated.valid, false);
  assert.ok(fabricated.errors.some((error) => /target|belegt|Schlag|Figur|Zug/iu.test(error)));

  const merelyDescriptive = buildApprovedCoachTrainingRecord(candidate, {
    reviewer: "PP",
    reviewedAt: "2026-08-05T20:00:00.000Z",
    textEdits: { moveIdea: "Damit stellst du einen Bauern ins Zentrum." },
  });
  assert.equal(merelyDescriptive.valid, false);
  assert.ok(merelyDescriptive.errors.some((error) => /Didaktik|warum/iu.test(error)));
});

test("Ablehnungen werden dokumentiert, aber nie zu freigegebenen Datensätzen", () => {
  const candidate = candidateForReview();
  const rejected = coachTrainingReviewEntry(candidate, {
    decision: "rejected",
    reviewer: "PP",
    notes: "Zu allgemein.",
  });

  assert.equal(rejected.valid, true);
  assert.equal(rejected.value.decision, "rejected");
  assert.equal(rejected.value.candidateVersion, 2);
  assert.equal(rejected.approvedRecord, null);
});
