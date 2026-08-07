import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { coachTrainingPositionAfterMove } from "../coachTrainingBoard.js";

function pieceAt(fen, square) {
  return new Chess(fen).get(square);
}

test("das Review-Brett zeigt die Stellung nach dem gespielten Zug", () => {
  const fen = new Chess().fen();
  const after = coachTrainingPositionAfterMove(fen, "e2e4");
  assert.equal(pieceAt(after, "e2"), undefined);
  assert.deepEqual(pieceAt(after, "e4"), { color: "w", type: "p" });
});

test("Rochade, en passant und Umwandlung werden auf dem Review-Brett ausgeführt", () => {
  const castled = coachTrainingPositionAfterMove(
    "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
    "e1g1",
  );
  assert.deepEqual(pieceAt(castled, "g1"), { color: "w", type: "k" });
  assert.deepEqual(pieceAt(castled, "f1"), { color: "w", type: "r" });

  const enPassant = coachTrainingPositionAfterMove(
    "8/8/8/3pP3/8/8/8/K6k w - d6 0 1",
    "e5d6",
  );
  assert.deepEqual(pieceAt(enPassant, "d6"), { color: "w", type: "p" });
  assert.equal(pieceAt(enPassant, "d5"), undefined);

  const promoted = coachTrainingPositionAfterMove(
    "7k/P7/8/8/8/8/8/K7 w - - 0 1",
    "a7a8q",
  );
  assert.deepEqual(pieceAt(promoted, "a8"), { color: "w", type: "q" });
});
