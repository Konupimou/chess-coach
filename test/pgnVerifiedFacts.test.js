import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { validateCoachLanguage } from "../coachLanguageQuality.js";
import {
  deterministicPgnMoveFacts,
  EXACT_PGN_MOVE_FACT_SCOPE,
  isExactPgnMoveFact,
  primaryDeterministicPgnMoveFact,
} from "../pgnVerifiedFacts.js";

function recordFor(fenBefore, uci, extra = {}) {
  const game = new Chess(fenBefore);
  const move = game.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.slice(4, 5) || undefined,
  });
  assert.ok(move, `Testzug ${uci} muss legal sein`);
  return { fenBefore, fenAfter: game.fen(), uci, ...extra };
}

function fenAfterMoves(moves) {
  const game = new Chess();
  moves.forEach((move) => game.move(move));
  return game.fen();
}

test("PGN-Brettfakten werden nur aus einem legalen Zug abgeleitet", () => {
  const facts = deterministicPgnMoveFacts(recordFor(new Chess().fen(), "g1f3", {
    metadata: { white: "Ada Lovelace", event: "Geheimer Titel" },
    annotation: { originalComment: "Laut Ada ist das der beste Zug!" },
  }));

  assert.deepEqual(facts.map((entry) => entry.comment), ["Nf3 entwickelt den Springer."]);
  assert.equal(facts[0].scope, EXACT_PGN_MOVE_FACT_SCOPE);
  assert.equal(facts[0].annotation.scope, EXACT_PGN_MOVE_FACT_SCOPE);
  assert.equal(facts[0].annotation.claims[0].verificationStatus, "automatically_verified");
  assert.equal(facts[0].annotation.claims[0].confidence, 1);
  assert.equal(isExactPgnMoveFact(facts[0]), true);
  assert.doesNotMatch(JSON.stringify(facts), /Ada|Lovelace|Geheimer Titel|beste Zug/u);
});

test("Schlag, Schach, Matt, Rochade, Umwandlung und Zentrum bleiben reine Fakten", () => {
  const captureFen = fenAfterMoves(["e4", "d5"]);
  const capture = deterministicPgnMoveFacts(recordFor(captureFen, "e4d5"));
  assert.equal(capture.some((entry) => entry.comment === "exd5 schlägt auf d5 einen Bauern."), true);

  const enPassantFen = fenAfterMoves(["e4", "a6", "e5", "d5"]);
  const enPassant = deterministicPgnMoveFacts(recordFor(enPassantFen, "e5d6"));
  assert.equal(
    enPassant.some((entry) => entry.comment === "exd6 schlägt auf d5 einen Bauern."),
    true,
  );

  const mateFen = fenAfterMoves(["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6"]);
  const mate = deterministicPgnMoveFacts(recordFor(mateFen, "h5f7"));
  assert.equal(mate.some((entry) => entry.comment === "Qxf7# setzt den König matt."), true);

  const castleFen = fenAfterMoves(["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"]);
  const castle = deterministicPgnMoveFacts(recordFor(castleFen, "e1g1"));
  assert.deepEqual(castle.map((entry) => entry.comment), ["O-O ist die kurze Rochade."]);

  const promotionFen = "7k/4P3/8/8/8/8/8/K7 w - - 0 1";
  const promotion = deterministicPgnMoveFacts(recordFor(promotionFen, "e7e8q"));
  assert.equal(promotion.some((entry) => entry.comment.includes("verwandelt den Bauern in eine Dame")), true);

  const center = deterministicPgnMoveFacts(recordFor(new Chess().fen(), "e2e4"));
  assert.deepEqual(center.map((entry) => entry.comment), ["Nach e4 steht ein Bauer im Zentrum."]);
  [...capture, ...enPassant, ...mate, ...castle, ...promotion, ...center].forEach((entry) => {
    assert.doesNotMatch(entry.comment, /(?:gut|besser|beste|Fehler|ungenau|Plan|weil)/iu);
    assert.equal(validateCoachLanguage(entry.comment, {
      rating: 800,
      phase: "",
      strict: true,
    }).valid, true, entry.comment);
  });
});

test("eine abweichende Folgestellung oder ein illegaler Zug sperrt die Freigabe", () => {
  assert.deepEqual(deterministicPgnMoveFacts({
    fenBefore: new Chess().fen(),
    fenAfter: new Chess().fen(),
    uci: "e2e4",
  }), []);
  assert.deepEqual(deterministicPgnMoveFacts({
    fenBefore: new Chess().fen(),
    uci: "e2e5",
  }), []);
  assert.deepEqual(deterministicPgnMoveFacts({
    fenBefore: "kein FEN",
    uci: "e2e4",
  }), []);
});

test("der Einsteigerhinweis enthält genau einen kurzen Fakt", () => {
  const mateFen = fenAfterMoves(["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6"]);
  const primary = primaryDeterministicPgnMoveFact(recordFor(mateFen, "h5f7"));
  assert.equal(primary.kind, "checkmate");
  assert.equal(primary.comment, "Qxf7# setzt den König matt.");
  assert.equal((primary.comment.match(/[.!?]/gu) || []).length, 1);
});
