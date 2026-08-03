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

test("Vergleichsevidenz trennt besten, gleichwertigen und gespielten Zug", () => {
  const evidence = buildPositionEvidence({
    fenBefore: START_FEN,
    playedUci: "d2d4",
    candidateLines: [
      {
        rank: 1,
        evaluation: { unit: "cp", value: 30, perspective: "white" },
        pvUci: ["e2e4", "e7e5"],
      },
      {
        rank: 2,
        evaluation: { unit: "cp", value: 24, perspective: "white" },
        pvUci: ["d2d4", "d7d5"],
      },
    ],
    playedLine: {
      evaluation: { unit: "cp", value: 24, perspective: "white" },
      pvUci: ["d2d4", "d7d5"],
    },
    lossCp: 6,
  });

  assert.equal(evidence.moveComparison.played.move.uci, "d2d4");
  assert.equal(evidence.moveComparison.best.move.uci, "e2e4");
  assert.equal(evidence.moveComparison.alternative.relation, "equivalent");
  assert.equal(evidence.moveComparison.explanationType, "equivalent");
  assert.equal(evidence.moveComparison.lossCp, 6);
});

test("ein gefesselter Springer erzeugt keine falsche Gabel-Evidenz", () => {
  const evidence = buildPositionEvidence({
    fenBefore: "k3r3/8/8/8/3q1r2/8/8/2N1K3 w - - 0 1",
    playedUci: "c1e2",
    candidateLines: [{
      rank: 1,
      evaluation: { unit: "cp", value: 0, perspective: "player" },
      pvUci: ["c1e2"],
    }],
  });

  assert.equal(evidence.valid, true);
  assert.equal(
    evidence.moveComparison.played.tacticalMotifs.some(
      (entry) => ["fork", "double_attack"].includes(entry.motif?.type),
    ),
    false,
  );
});

test("ein Springer mit zwei legalen Schlagzielen bleibt als Gabel belegt", () => {
  const evidence = buildPositionEvidence({
    fenBefore: "k7/8/3q1r2/8/8/2N5/8/7K w - - 0 1",
    playedUci: "c3e4",
    candidateLines: [{
      rank: 1,
      evaluation: { unit: "cp", value: 0, perspective: "player" },
      pvUci: ["c3e4"],
    }],
  });

  const fork = evidence.moveComparison.played.tacticalMotifs.find(
    (entry) => entry.motif?.type === "fork",
  );
  assert.deepEqual(
    fork?.motif?.targets.map((target) => target.square).sort(),
    ["d6", "f6"],
  );
});

test("die bessere Linie belegt eine konkrete Figurenentwicklung", () => {
  const evidence = buildPositionEvidence({
    fenBefore: START_FEN,
    playedUci: "a2a3",
    candidateLines: [
      {
        rank: 1,
        evaluation: { unit: "cp", value: 35, perspective: "white" },
        pvUci: ["g1f3", "g8f6"],
      },
      {
        rank: 2,
        evaluation: { unit: "cp", value: 0, perspective: "white" },
        pvUci: ["a2a3", "g8f6"],
      },
    ],
  });

  assert.ok(
    evidence.moveComparison.differences.some(
      (difference) => (
        difference.type === "develops_piece"
        && difference.piece === "n"
        && difference.square === "f3"
      ),
    ),
  );
});

test("ein Bauernzug kann ein konkret belegtes gegnerisches Schach erlauben", () => {
  const game = new Chess();
  game.move("f3");
  game.move("e5");
  const evidence = buildPositionEvidence({
    fenBefore: game.fen(),
    playedUci: "g2g4",
    candidateLines: [
      {
        rank: 1,
        evaluation: { unit: "cp", value: 10, perspective: "white" },
        pvUci: ["e2e4", "b8c6"],
      },
      {
        rank: 2,
        evaluation: { unit: "cp", value: 0, perspective: "white" },
        pvUci: ["g1h3", "b8c6"],
      },
    ],
    playedLine: {
      evaluation: { unit: "mate", value: -1, perspective: "white" },
      pvUci: ["g2g4", "d8h4"],
    },
    lossCp: 10_000,
  });

  assert.equal(evidence.moveComparison.played.opponentBestReply.san, "Qh4#");
  assert.ok(
    evidence.moveComparison.differences.some(
      (difference) => difference.type === "allows_check",
    ),
  );
  assert.ok(
    evidence.moveComparison.differences.some(
      (difference) => difference.type === "allows_checkmate",
    ),
  );
});

test("Materialverlust innerhalb der geprüften Linie wird vergleichbar", () => {
  const fen = "3q2k1/8/8/8/8/8/3Q4/6K1 w - - 0 1";
  const evidence = buildPositionEvidence({
    fenBefore: fen,
    playedUci: "d2d3",
    candidateLines: [
      {
        rank: 1,
        evaluation: { unit: "cp", value: 0, perspective: "white" },
        pvUci: ["d2e3", "g8f7"],
      },
      {
        rank: 2,
        evaluation: { unit: "cp", value: -900, perspective: "white" },
        pvUci: ["d2d3", "d8d3"],
      },
    ],
    playedLine: {
      evaluation: { unit: "cp", value: -900, perspective: "white" },
      pvUci: ["d2d3", "d8d3"],
    },
    lossCp: 900,
  });

  assert.equal(evidence.moveComparison.comparisonHorizon, 2);
  assert.equal(evidence.moveComparison.materialComparison.equalLength, true);
  assert.equal(evidence.moveComparison.played.materialBalanceDelta, -9);
  assert.ok(
    evidence.moveComparison.differences.some(
      (difference) => difference.type === "material_outcome",
    ),
  );
});

test("Rochade und konkrete Bauernstruktur bleiben in beiden Vergleichsarmen messbar", () => {
  const castling = buildPositionEvidence({
    fenBefore: "r3k2r/5ppp/8/8/8/8/5PPP/R3K2R w KQkq - 0 1",
    playedUci: "e1g1",
    candidateLines: [
      {
        rank: 1,
        evaluation: { unit: "cp", value: 20, perspective: "white" },
        pvUci: ["e1g1", "e8g8"],
      },
      {
        rank: 2,
        evaluation: { unit: "cp", value: 0, perspective: "white" },
        pvUci: ["e1c1", "e8c8"],
      },
    ],
  });
  assert.ok(
    castling.moveComparison.played.immediateEffects.some(
      (effect) => effect.type === "castles",
    ),
  );

  const pawnStructure = buildPositionEvidence({
    fenBefore: "7k/8/8/8/2p5/3P4/2P5/7K w - - 0 1",
    playedUci: "d3c4",
    candidateLines: [{
      rank: 1,
      evaluation: { unit: "cp", value: 50, perspective: "white" },
      pvUci: ["d3c4", "h8g7"],
    }],
  });
  assert.ok(
    pawnStructure.moveComparison.played.immediateEffects.some(
      (effect) => effect.type === "creates_doubled_pawns",
    ),
  );
});

test("onlyMove und Bewertungsperspektive werden aus belegten Kandidaten abgeleitet", () => {
  const onlyMove = buildPositionEvidence({
    fenBefore: START_FEN,
    playedUci: "e2e4",
    candidateLines: [
      {
        rank: 1,
        evaluation: { unit: "cp", value: 0, perspective: "white" },
        pvUci: ["e2e4", "e7e5"],
      },
      {
        rank: 2,
        evaluation: { unit: "cp", value: -200, perspective: "white" },
        pvUci: ["d2d4", "d7d5"],
      },
    ],
  });
  assert.equal(onlyMove.moveComparison.onlyMove, true);
  assert.deepEqual(onlyMove.moveComparison.onlyMoveEvidence, {
    type: "only_move_to_avoid_loss",
    legalMoveCount: null,
    gapCp: 200,
    bestCp: 0,
    secondCp: -200,
    reason: "rank_two_crosses_losing_result_band",
  });

  const game = new Chess();
  game.move("e4");
  const black = buildPositionEvidence({
    fenBefore: game.fen(),
    playedUci: "e7e5",
    candidateLines: [
      {
        rank: 1,
        evaluation: { unit: "cp", value: 20, perspective: "white" },
        pvUci: ["e7e5", "g1f3"],
      },
      {
        rank: 2,
        evaluation: { unit: "cp", value: 40, perspective: "white" },
        pvUci: ["d7d5", "e4d5"],
      },
    ],
  });
  assert.equal(black.moveComparison.best.evaluation.perspective, "player");
  assert.equal(black.moveComparison.best.evaluation.value, -20);
  assert.equal(black.moveComparison.alternative.evaluation.value, -40);
});
