import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  buildLocalMoveExplanation,
  buildTrustedExplanationEvidence,
  moveExplanationToMarkdown,
  verifyMoveExplanation,
} from "../coachExplanation.js";
import { learnerProfileForCoach } from "../learnerProfile.js";
import { buildPositionEvidence } from "../positionEvidence.js";

function explanationForAuditPosition({ fen, san }) {
  const game = new Chess(fen);
  const move = game.move(san);
  assert.ok(move, `${san} muss in der Audit-Stellung legal sein`);

  const uci = `${move.from}${move.to}${move.promotion || ""}`;
  const perspective = fen.split(/\s+/)[1] === "w" ? "white" : "black";
  const evaluation = { unit: "cp", value: 0, perspective };
  const bestMove = { uci, san: move.san };
  const primaryVariation = { uci: [uci], san: [move.san] };
  const engineContext = {
    source: "stockfish",
    kind: "move_review",
    fen,
    depth: 5,
    evaluation,
    bestMove,
    primaryVariation,
    lines: [{
      rank: 1,
      depth: 5,
      evaluation,
      bestMove,
      pv: primaryVariation,
    }],
    playedLine: {
      evaluation,
      uci: [uci],
      san: [move.san],
    },
    moveReview: {
      playedMove: bestMove,
      bestMove,
      quality: "best",
      lossCp: 0,
      evaluationBefore: evaluation,
      evaluationAfter: evaluation,
      pv: primaryVariation,
    },
  };
  const positionEvidence = buildPositionEvidence({
    fenBefore: fen,
    playedUci: uci,
    candidateLines: [{ rank: 1, evaluation, pvUci: [uci] }],
    playedLine: { evaluation, pvUci: [uci] },
    lossCp: 0,
    quality: "best",
    engineDepth: 5,
  });
  const explanation = buildLocalMoveExplanation({
    positionEvidence,
    engineContext,
    learnerProfile: learnerProfileForCoach({ rating: 800 }),
  });
  const verification = verifyMoveExplanation(explanation, {
    positionEvidence: buildTrustedExplanationEvidence({
      positionEvidence,
      engineContext,
    }),
    engineContext,
  });

  assert.equal(verification.valid, true, verification.errors?.join("\n"));
  return moveExplanationToMarkdown(verification.value, { deep: true });
}

const auditCases = [
  {
    name: "Schlagzug",
    fen: "rnbqkbn1/p1pBppp1/8/1p5r/8/8/PPPPPP1P/RNBQK1NR b KQq - 0 4",
    san: "Qxd7",
    expected: /\b(?:nimmt|schlägt)\b/iu,
  },
  {
    name: "Schachgebot",
    fen: "r1bqk1nr/p1pp1pp1/8/1P1Np2p/4P3/3Q4/P2P1KPP/R1B2BNR b kq - 0 9",
    san: "Qf6+",
    expected: /\bschach\b/iu,
  },
  {
    name: "Mattzug",
    fen: "8/8/8/1P6/P2p4/1p1P1K1k/8/2R5 w - - 1 38",
    san: "Rh1#",
    expected: /\bmatt\b/iu,
  },
];

for (const auditCase of auditCases) {
  test(`der 800-Elo-Coach erklärt den unmittelbaren Effekt: ${auditCase.name}`, () => {
    const markdown = explanationForAuditPosition(auditCase);
    assert.match(markdown, auditCase.expected);
  });
}
