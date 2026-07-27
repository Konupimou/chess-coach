import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  buildPositionEvidence,
  EVIDENCE_KINDS,
  verifyLegalPrincipalVariation,
} from "../positionEvidence.js";

const START_FEN = new Chess().fen();

test("e4 wird legal verifiziert und belegt Zentrumseinfluss ohne Spekulation", () => {
  const evidence = buildPositionEvidence({
    fenBefore: START_FEN,
    playedUci: "e2e4",
    lines: [
      { rank: 1, pv: ["e2e4", "e7e5", "g1f3"] },
      { rank: 2, pv: { uci: ["d2d4", "d7d5"] } },
    ],
  });

  assert.equal(evidence.valid, true);
  assert.equal(evidence.playedMove.legal, true);
  assert.equal(evidence.playedMove.san, "e4");
  assert.equal(evidence.after.center.byColor.w.occupiedSquares.includes("e4"), true);
  assert.equal(
    evidence.changes.center.byColor.w.newlyAttackedSquares.includes("d5"),
    true,
  );
  assert.equal(evidence.changes.material.byColor.w.points, 0);
  assert.deepEqual(
    evidence.verifiedLines[0].moves.map((move) => move.san),
    ["e4", "e5", "Nf3"],
  );
  assert.ok(
    evidence.evidence.some(
      (item) => item.kind === EVIDENCE_KINDS.centerChange,
    ),
  );
  assert.ok(evidence.evidence.every((item) => typeof item.id === "string"));
});

test("Rochade erfasst legal König, Turm, Rechte und Bauernschutz", () => {
  const fen = "r3k2r/5ppp/8/8/8/8/5PPP/R3K2R w KQkq - 0 1";
  const evidence = buildPositionEvidence({
    fenBefore: fen,
    playedUci: "e1g1",
  });

  assert.equal(evidence.valid, true);
  assert.equal(evidence.playedMove.san, "O-O");
  assert.equal(evidence.playedMove.castle, "kingside");
  assert.equal(evidence.after.kingSafety.byColor.w.kingSquare, "g1");
  assert.equal(evidence.after.kingSafety.byColor.w.castlingRights.kingside, false);
  assert.equal(evidence.after.kingSafety.byColor.w.castlingRights.queenside, false);
  assert.deepEqual(
    evidence.after.kingSafety.byColor.w.frontAdjacentFriendlyPawns,
    ["f2", "g2", "h2"],
  );
  assert.equal(evidence.changes.kingSafety.castled, "kingside");
});

test("Schlagzug belegt Materialdelta, Schlagfeld und neu halboffene Linie", () => {
  const game = new Chess();
  game.move("e4");
  game.move("d5");
  const evidence = buildPositionEvidence({
    fenBefore: game.fen(),
    playedUci: "e4d5",
  });

  assert.equal(evidence.valid, true);
  assert.deepEqual(evidence.playedMove.capture, {
    capturedPiece: "p",
    square: "d5",
    enPassant: false,
  });
  assert.equal(evidence.changes.material.byColor.b.counts.p, -1);
  assert.equal(evidence.changes.material.byColor.b.points, -1);
  assert.equal(evidence.after.material.balanceWhiteMinusBlack, 1);
  assert.ok(evidence.after.files.semiOpen.b.includes("d"));
});

test("illegale Züge und ungültige Stellungen erzeugen keine Zug-Evidenz", () => {
  const illegalMove = buildPositionEvidence({
    fenBefore: START_FEN,
    playedUci: "e2e5",
  });
  assert.equal(illegalMove.valid, false);
  assert.equal(illegalMove.playedMove, null);
  assert.equal(illegalMove.issues[0].code, "illegal_played_move");
  assert.equal(
    illegalMove.evidence.some((item) => item.kind === EVIDENCE_KINDS.legalMove),
    false,
  );

  const invalidFen = buildPositionEvidence({
    fenBefore: "keine FEN",
    playedUci: "e2e4",
  });
  assert.equal(invalidFen.valid, false);
  assert.equal(invalidFen.issues[0].code, "invalid_fen_before");
  assert.deepEqual(invalidFen.evidence, []);
});

test("abweichendes fenAfter wird gemeldet und niemals als Faktenbasis verwendet", () => {
  const evidence = buildPositionEvidence({
    fenBefore: START_FEN,
    playedUci: "e2e4",
    fenAfter: START_FEN,
  });

  assert.equal(evidence.valid, true);
  assert.equal(evidence.input.fenAfterPositionMatches, false);
  assert.equal(evidence.issues[0].code, "fen_after_position_mismatch");
  assert.equal(evidence.after.fen, evidence.playedMove.fenAfter);
});

test("eine Hauptvariante endet vor dem ersten illegalen Zug", () => {
  const result = verifyLegalPrincipalVariation(
    START_FEN,
    ["e2e4", "e7e5", "g1g3", "b8c6"],
  );

  assert.equal(result.legal, false);
  assert.equal(result.complete, false);
  assert.equal(result.rejectedAt, 2);
  assert.equal(result.rejectedMove, "g1g3");
  assert.deepEqual(result.moves.map((move) => move.uci), ["e2e4", "e7e5"]);
});

test("Umwandlung und Schach werden ausschließlich aus dem legalen Zug abgeleitet", () => {
  const evidence = buildPositionEvidence({
    fenBefore: "7k/P7/8/8/8/8/8/7K w - - 0 1",
    playedUci: "a7a8q",
  });

  assert.equal(evidence.valid, true);
  assert.equal(evidence.playedMove.promotion, "q");
  assert.equal(evidence.playedMove.givesCheck, true);
  assert.equal(evidence.changes.material.byColor.w.counts.p, -1);
  assert.equal(evidence.changes.material.byColor.w.counts.q, 1);
  assert.equal(evidence.changes.material.byColor.w.points, 8);
});

test("eine direkt als Zugliste übergebene PV wird ebenfalls geprüft", () => {
  const evidence = buildPositionEvidence({
    fenBefore: START_FEN,
    playedUci: "e2e4",
    lines: ["e2e4", "e7e5"],
  });

  assert.equal(evidence.verifiedLines.length, 1);
  assert.deepEqual(
    evidence.verifiedLines[0].moves.map((move) => move.san),
    ["e4", "e5"],
  );
});
