import test from "node:test";
import assert from "node:assert/strict";

import { recognizePositionPatterns } from "../patternRecognition.js";

const winningForkFen = "r1bqkbnr/ppp2p1p/2np2p1/6N1/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 1";
const defendedForkFen = "r1bqkb1r/ppp2p1p/2np2pn/6N1/8/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 1";

function forkByMove(patterns, uci) {
  return patterns.find((pattern) => pattern.type === "fork" && pattern.move?.uci === uci);
}

test("eine unmittelbar verfügbare Springergabel wird mit Zielen und Beweiszug erkannt", () => {
  const patterns = recognizePositionPatterns({ fenAfter: winningForkFen });
  const fork = forkByMove(patterns, "g5f7");

  assert.ok(fork);
  assert.equal(fork.status, "winning");
  assert.deepEqual(fork.targets.map((target) => target.square), ["d8", "h8"]);
  assert.equal(fork.proofLine[0], "Nxf7");
  assert.match(fork.explanation, /gleichzeitig/);
});

test("eine bereits ausgeführte Gabel bleibt auch beim gegnerischen Zug sichtbar", () => {
  const fen = "3qk2r/5N2/8/8/2B5/8/8/4K3 b - - 0 1";
  const patterns = recognizePositionPatterns({ fenAfter: fen });

  assert.ok(patterns.some((pattern) => pattern.type === "fork" && pattern.side === "w"));
});

test("eine gedeckte Gabel wird als widerlegt und nicht als Chance markiert", () => {
  const patterns = recognizePositionPatterns({ fenAfter: defendedForkFen });
  const fork = forkByMove(patterns, "g5f7");

  assert.ok(fork);
  assert.equal(fork.status, "refuted");
  assert.equal(fork.proofLine.length, 2);
  assert.match(fork.explanation, /schlägt den Angreifer sofort/);
});

test("ein gefesselter oder sonst illegaler Verteidiger widerlegt die Gabel nicht", () => {
  const fen = "3q3k/5p2/7n/6N1/2B5/8/8/4K2R w - - 0 1";
  const patterns = recognizePositionPatterns({ fenAfter: fen });
  const fork = forkByMove(patterns, "g5f7");

  assert.ok(fork);
  assert.equal(fork.status, "winning");
});

test("ein durch den letzten Zug zugelassenes Motiv erhält den Zeitbezug created", () => {
  const before = "r1bqkbnr/ppp2ppp/2np4/6N1/2B5/4P3/PPPP1PPP/RNBQK2R b KQkq - 0 1";
  const after = winningForkFen.replace(" w KQkq - 0 1", " w KQkq - 0 2");
  const patterns = recognizePositionPatterns({ fenBefore: before, fenAfter: after });
  const fork = forkByMove(patterns, "g5f7");

  assert.ok(fork);
  assert.equal(fork.timing, "created");
  assert.match(fork.timingText, /letzten Zug entstanden/);
});

test("strategische Treffer gleicher Art und Seite werden gruppiert", () => {
  const initial = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const patterns = recognizePositionPatterns({ fenAfter: initial });
  const whiteBadBishops = patterns.filter((pattern) => pattern.type === "bad_bishop" && pattern.side === "w");

  assert.ok(whiteBadBishops.length <= 1);
});

test("nach frühem Qh5 werden normale Eröffnungsfiguren nicht als schlechte Läufer oder Raumvorteil gemeldet", () => {
  const fen = "rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2";
  const patterns = recognizePositionPatterns({ fenAfter: fen });

  assert.equal(patterns.some((pattern) => pattern.type === "bad_bishop"), false);
  assert.equal(patterns.some((pattern) => pattern.type === "space_advantage"), false);
  const pin = patterns.find((pattern) => pattern.type === "pin" && pattern.side === "w");
  assert.ok(pin);
  assert.match(pin.explanation, /h5.*f7.*e8/);
});

test("ein Spieß wird als eigenes taktisches Muster erkannt", () => {
  const patterns = recognizePositionPatterns({ fenAfter: "q7/k7/8/8/8/8/8/R3K3 b - - 0 1" });
  const skewer = patterns.find((pattern) => pattern.type === "skewer" && pattern.side === "w");

  assert.ok(skewer);
  assert.deepEqual(skewer.targets.map((target) => target.square), ["a7", "a8"]);
});

test("ein freigelegter Linienangriff wird als Abzugsangriff erkannt", () => {
  const fen = "k3q3/8/8/8/8/8/4B3/K3R3 w - - 0 1";
  const patterns = recognizePositionPatterns({ fenAfter: fen });
  const discovered = patterns.find((pattern) => (
    pattern.type === "discovered_attack" && pattern.move?.uci === "e2d3"
  ));

  assert.ok(discovered);
  assert.equal(discovered.targets[0].square, "e8");
});

test("ein Abzugsangriff gilt als widerlegt, wenn das Ziel zuerst die Dame schlägt", () => {
  const fen = "3qk3/4p3/8/6B1/8/8/8/4K3 b - - 0 1";
  const patterns = recognizePositionPatterns({ fenAfter: fen });
  const discovered = patterns.find((pattern) => (
    pattern.type === "discovered_attack" && pattern.move?.uci === "e7e6"
  ));

  assert.ok(discovered);
  assert.equal(discovered.status, "refuted");
  assert.deepEqual(discovered.proofLine, ["e6", "Bxd8", "Kxd8"]);
  assert.match(discovered.explanation, /wertvollere angreifende Figur/);
});

test("eine gedeckte Bauerngabel bleibt durch die günstige Rücknahme wirksam", () => {
  const fen = "3qk3/5p2/8/4N1B1/8/8/8/4K3 b - - 0 1";
  const patterns = recognizePositionPatterns({ fenAfter: fen });
  const fork = forkByMove(patterns, "f7f6");

  assert.ok(fork);
  assert.equal(fork.status, "winning");
  assert.equal(fork.materialGain, 2);
  assert.ok(fork.materialBalanceAfter > 0);
  assert.deepEqual(fork.proofLine, ["f6", "Bxf6", "Qxf6"]);
});

test("ungültige Stellungen liefern keine Muster", () => {
  assert.deepEqual(recognizePositionPatterns({ fenAfter: "kein fen" }), []);
});
