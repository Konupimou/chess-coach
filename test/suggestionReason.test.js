import test from "node:test";
import assert from "node:assert/strict";
import { technicalSuggestionReason } from "../suggestionReason.js";

test("beste ruhige Stockfish-Idee erhält eine klare technische Begründung", () => {
  assert.equal(
    technicalSuggestionReason({ rank: 1, sanMoves: ["e4", "e5"] }),
    "Stockfish bewertet diese Fortsetzung in der aktuellen Stellung am stärksten.",
  );
});

test("konkrete Merkmale der ersten Zugidee werden vorsichtig benannt", () => {
  assert.equal(
    technicalSuggestionReason({ rank: 1, sanMoves: ["Dh5+"] }),
    "Der Zug beginnt mit Schach und zwingt eine direkte Antwort.",
  );
  assert.equal(
    technicalSuggestionReason({ rank: 1, sanMoves: ["Sxf7"] }),
    "Die Idee beginnt mit einem konkreten Schlagzug.",
  );
  assert.equal(
    technicalSuggestionReason({ rank: 1, sanMoves: ["O-O"] }),
    "Stockfish bewertet die Rochade in dieser Stellung als stärkste Fortsetzung.",
  );
});

test("Alternativen vergleichen den Abstand aus Sicht der ziehenden Farbe", () => {
  assert.equal(
    technicalSuggestionReason({
      rank: 2,
      sanMoves: ["c5"],
      score: { unit: "cp", value: -60 },
      bestScore: { unit: "cp", value: -80 },
      sideToMove: "b",
    }),
    "Diese Alternative liegt laut Stockfish nur 0,20 Bauerneinheiten hinter der besten Idee.",
  );
});

test("Mattbewertungen werden nur als Engine-Fakt beschrieben", () => {
  assert.equal(
    technicalSuggestionReason({
      rank: 1,
      sanMoves: ["Dh7#"],
      score: { unit: "mate", value: 1 },
      sideToMove: "w",
    }),
    "Der Zug setzt sofort matt.",
  );
});
