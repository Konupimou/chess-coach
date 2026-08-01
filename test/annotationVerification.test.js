import test from "node:test";
import assert from "node:assert/strict";
import {
  approveVerifiedAnnotation,
  verifyAnnotationRecord,
} from "../annotationVerification.js";

const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const record = {
  id: "record",
  fenBefore: fen,
  uci: "e2e4",
  annotation: {
    type: "strategic",
    alternatives: [{ uci: "d2d4", san: "d4" }],
    claims: [{ field: "recommendedAlternative", value: "d4", verificationStatus: "unverified" }],
  },
};

function analysis(d4, e4 = 20) {
  return {
    fen,
    engineVersion: "Stockfish test",
    depth: 12,
    limit: { type: "depth", value: 12 },
    lines: [
      { uci: "e2e4", evaluation: { unit: "cp", value: e4 } },
      { uci: "d2d4", evaluation: { unit: "cp", value: d4 } },
    ],
  };
}

test("minimale Engineabweichung bleibt eine kompatible menschliche Empfehlung", () => {
  const result = verifyAnnotationRecord(record, analysis(10));
  assert.equal(result.verificationStatus, "compatible");
  assert.equal(result.reason, "different_but_equivalent");
  assert.equal(result.lifecycle, "automatically_verified");
});

test("deutlicher Widerspruch bleibt vom Trainingsbestand ausgeschlossen", () => {
  const result = verifyAnnotationRecord(record, analysis(-200));
  assert.equal(result.verificationStatus, "conflicting");
  assert.equal(result.lifecycle, "generated");
});

test("nur geprüfte Annotationen können ausdrücklich menschlich freigegeben werden", () => {
  const verified = verifyAnnotationRecord(record, analysis(10));
  const approved = approveVerifiedAnnotation(verified, {
    reviewer: "Test Reviewer",
    reviewedAt: "2026-07-31T00:00:00.000Z",
  });
  assert.equal(approved.lifecycle, "human_approved");
  assert.throws(() => approveVerifiedAnnotation(
    verifyAnnotationRecord(record, analysis(-200)),
    { reviewer: "Test Reviewer" },
  ));
});
