import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Chess } from "chess.js";
import {
  createOpeningBook,
  detectOpeningAfterMove,
  detectOpeningFromPath,
  displayOpeningName,
  normalizeFenToEpd,
  openingContinuationsForPath,
  openingCoachContext,
  parseOpeningName,
} from "../openingRecognition.js";

const runtime = JSON.parse(
  await readFile(new URL("../public/data/openings/openings.runtime.json", import.meta.url), "utf8"),
);
const book = createOpeningBook(runtime);

function pathFromUci(sequence, fen = new Chess().fen()) {
  const game = new Chess(fen);
  const path = [{ fen: game.fen() }];
  for (const uci of sequence.trim().split(/\s+/).filter(Boolean)) {
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || undefined,
    });
    path.push({ move, fen: game.fen() });
  }
  return path;
}

const cases = [
  ["Italienische Partie", "e2e4 e7e5 g1f3 b8c6 f1c4", "C50", "Italian Game"],
  ["Spanische Partie", "e2e4 e7e5 g1f3 b8c6 f1b5", "C60", "Ruy Lopez"],
  ["Sizilianische Verteidigung", "e2e4 c7c5", "B20", "Sicilian Defense"],
  ["Najdorf-Variante", "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6", "B90", "Najdorf Variation"],
  ["Französische Verteidigung", "e2e4 e7e6", "C00", "French Defense"],
  ["Caro-Kann-Verteidigung", "e2e4 c7c6", "B10", "Caro-Kann Defense"],
  ["Damengambit", "d2d4 d7d5 c2c4", "D06", "Queen's Gambit"],
  ["Königsindische Verteidigung", "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6", "E70", "King's Indian Defense"],
  ["Englische Eröffnung", "c2c4", "A10", "English Opening"],
  ["Réti-Eröffnung", "g1f3 d7d5 c2c4", "A09", "Réti Opening"],
];

test("der vorgeschlagene erste Zug liefert bereits einen Eröffnungsnamen", () => {
  const result = detectOpeningAfterMove(pathFromUci(""), "e2e4", book);
  assert.equal(result.matched, true);
  assert.equal(result.sourceName, "King's Pawn Game");
  assert.equal(result.displayName, "Königbauernspiel");
  assert.equal(result.matchedPly, 1);
});

test("das Eröffnungsbuch liefert mehrere gleichberechtigte Fortsetzungen", () => {
  const initial = openingContinuationsForPath(pathFromUci(""), book, { limit: 5 });
  assert.ok(initial.length >= 3);
  assert.ok(initial.every((entry) => entry.source === "lichess-chess-openings"));
  assert.ok(initial.every((entry) => entry.variationCount > 0));
  assert.ok(initial.some((entry) => entry.uci === "e2e4"));

  const afterE4E5 = openingContinuationsForPath(
    pathFromUci("e2e4 e7e5"),
    book,
    { limit: 5 },
  );
  assert.ok(afterE4E5.length >= 2);
  assert.ok(afterE4E5.some((entry) => entry.uci === "g1f3"));
});

for (const [label, sequence, eco, sourceFragment] of cases) {
  test(`${label} wird aus der lokalen ECO-Datenbank erkannt`, () => {
    const result = detectOpeningFromPath(pathFromUci(sequence), book);
    assert.equal(result.matched, true);
    assert.equal(result.eco, eco);
    assert.match(result.sourceName, new RegExp(sourceFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(result.confidence, "exact-sequence");
  });
}

test("die spezifischste vorhandene Untervariante bleibt erhalten", () => {
  const result = detectOpeningFromPath(pathFromUci(
    "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 f6g4",
  ), book);
  assert.equal(
    result.sourceName,
    "Sicilian Defense: Najdorf Variation, English Attack, Anti-English",
  );
  assert.equal(result.variation, "Najdorf Variation");
  assert.equal(result.subvariation, "English Attack, Anti-English");
});

test("dieselbe Stellung wird über eine Zugumstellung positionsgenau erkannt", () => {
  const result = detectOpeningFromPath(pathFromUci(
    "g1f3 g8f6 c2c4 e7e6 d2d4 b7b6",
  ), book);
  assert.equal(result.sourceName, "Queen's Indian Defense");
  assert.equal(result.confidence, "transposition-position");
  assert.equal(result.inKnownSequence, false);
});

test("eine unbekannte Ausgangsstellung bleibt ausdrücklich unbekannt", () => {
  const result = detectOpeningFromPath([
    { fen: "8/8/8/8/8/8/4K3/7k w - - 0 1" },
  ], book);
  assert.equal(result.matched, false);
  assert.equal(result.confidence, "unknown");
});

test("eine ungültige Zugfolge wird nicht teilweise als Eröffnung ausgegeben", () => {
  const path = pathFromUci("e2e4");
  path.push({ move: { from: "e2", to: "e5" }, fen: path.at(-1).fen });
  const result = detectOpeningFromPath(path, book);
  assert.equal(result.matched, false);
  assert.equal(result.invalidAtPly, 2);
});

test("EPD behält ein legales En-passant-Feld und entfernt ein illegales", () => {
  assert.equal(
    normalizeFenToEpd("8/8/8/3pP3/8/8/8/4K2k w - d6 0 1").endsWith(" d6"),
    true,
  );
  assert.equal(
    normalizeFenToEpd("4r3/8/8/3pP3/8/8/8/4K2k w - d6 0 1").endsWith(" -"),
    true,
  );
});

test("Rochaderechte sind Teil des normalisierten EPD", () => {
  assert.equal(
    normalizeFenToEpd("r3k2r/8/8/8/8/8/8/R3K2R w qKkQ - 9 27"),
    "r3k2r/8/8/8/8/8/8/R3K2R w KQkq -",
  );
});

test("eine später wieder erreichte benannte Position zählt am Rückkehrzug", () => {
  const result = detectOpeningFromPath(pathFromUci(
    "e2e4 e7e5 g1f3 b8c6 f3g1 c6b8",
  ), book);
  assert.equal(result.sourceName, "King's Pawn Game");
  assert.equal(result.matchedPly, 6);
  assert.equal(result.confidence, "exact-position");
});

test("nach einer Abweichung bleibt die letzte benannte Eröffnung vorsichtig erhalten", () => {
  const result = detectOpeningFromPath(pathFromUci(
    "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 a2a3",
  ), book);
  assert.equal(result.sourceName, "Sicilian Defense: Najdorf Variation");
  assert.equal(result.matchedPly, 10);
  assert.equal(result.currentPly, 11);
  assert.equal(result.sequenceExitPly, 11);
  assert.equal(result.sequenceExitMove, "a2a3");
  assert.equal(result.confidence, "parent-opening");
  assert.equal("inTheory" in result, false);
});

test("openingContext enthält nur den erkannten Eintrag und notwendige Metadaten", () => {
  const result = detectOpeningFromPath(pathFromUci(
    "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6",
  ), book);
  const context = openingCoachContext(result);
  assert.deepEqual(context, {
    matched: true,
    eco: "B90",
    sourceName: "Sicilian Defense: Najdorf Variation",
    displayName: "Sizilianische Verteidigung: Najdorf-Variante",
    family: "Sicilian Defense",
    variation: "Najdorf Variation",
    subvariation: null,
    matchedPly: 10,
    currentPly: 10,
    matchedBy: "exact-sequence",
    inKnownSequence: true,
    sequenceExitPly: null,
    source: "lichess-chess-openings",
  });
  assert.equal("entries" in context, false);
});

test("Namen werden strukturiert und konservativ übersetzt", () => {
  assert.deepEqual(
    parseOpeningName("Sicilian Defense: Najdorf Variation, English Attack"),
    {
      original: "Sicilian Defense: Najdorf Variation, English Attack",
      family: "Sicilian Defense",
      variation: "Najdorf Variation",
      subvariation: "English Attack",
    },
  );
  assert.equal(
    displayOpeningName("Sicilian Defense: Najdorf Variation, English Attack"),
    "Sizilianische Verteidigung: Najdorf-Variante, Englischer Angriff",
  );
});
