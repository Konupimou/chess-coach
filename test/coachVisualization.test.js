import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  buildCoachVisualPlan,
  buildTerminalVisualPlan,
  moveQualityPresentation,
} from "../coachVisualization.js";

test("ruhige strategische Varianten bleiben kurz und legal", () => {
  const fen = new Chess().fen();
  const plan = buildCoachVisualPlan({
    fen,
    pv: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"],
  });

  assert.ok(plan);
  assert.equal(plan.tactical, false);
  assert.equal(plan.plyCount, 1);
  assert.deepEqual(plan.san, ["e4"]);
  assert.match(plan.headline, /Zentrum/);
  assert.deepEqual(
    plan.persistentAnnotations.highlights
      .filter((entry) => entry.role === "concept")
      .map((entry) => entry.square)
      .sort(),
    ["d4", "d5", "e4", "e5"],
  );
});

test("Matt-Visualisierung markiert König, Angreifer und Angriffspfeil", () => {
  const plan = buildTerminalVisualPlan("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1");
  assert.equal(plan.terminal, "checkmate");
  assert.match(plan.headline, /Schachmatt/);
  assert.ok(plan.persistentAnnotations.highlights.some((entry) => entry.role === "danger"));
  assert.ok(plan.persistentAnnotations.arrows.some((entry) => entry.role === "threat"));
});

test("eine konkrete Springergabel wird benannt und am Brett markiert", () => {
  const plan = buildCoachVisualPlan({
    fen: "k7/8/3q1r2/8/8/2N5/8/7K w - - 0 1",
    pv: ["c3e4"],
  });

  assert.ok(plan);
  assert.equal(plan.tactical, true);
  assert.equal(plan.motif, "Gabel");
  assert.equal(plan.plyCount, 1);
  assert.match(plan.explanation, /Gabel/);
  assert.deepEqual(
    plan.annotations.highlights
      .filter((entry) => entry.role === "target")
      .map((entry) => entry.square)
      .sort(),
    ["d6", "f6"],
  );
  assert.equal(
    plan.annotations.arrows.filter((entry) => entry.role === "threat").length,
    2,
  );
  assert.equal(plan.frames.at(-1).fen, plan.frames[0].fen);
});

test("Qxd4 ist ein einfacher Schlagzug und kein Doppelangriff auf zwei Bauern", () => {
  const plan = buildCoachVisualPlan({
    fen: "r1bqkbnr/pppp1ppp/8/8/3nP3/8/PPP2PPP/RNBQKB1R w KQkq - 0 5",
    pv: ["d1d4"],
  });

  assert.ok(plan);
  assert.equal(plan.tactical, false);
  assert.equal(plan.motif, "");
  assert.equal(plan.ideaKind, "capture");
  assert.doesNotMatch(plan.headline, /Doppelangriff/);
  assert.deepEqual(plan.san, ["Qxd4"]);
});

test("eine spätere Abtauschfolge macht einen strategischen Zug nicht zur Taktik", () => {
  const game = new Chess();
  game.move("d4");
  const plan = buildCoachVisualPlan({
    fen: game.fen(),
    pv: ["d7d5", "c2c4", "e7e6", "c4d5", "e6d5", "g1f3"],
  });

  assert.ok(plan);
  assert.equal(plan.tactical, false);
  assert.equal(plan.motif, "");
  assert.equal(plan.plyCount, 1);
  assert.deepEqual(plan.san, ["d5"]);
});

test("Rochade zeigt Königsschutz und den dazugehörigen Turmzug", () => {
  const plan = buildCoachVisualPlan({
    fen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
    pv: ["e1g1"],
  });

  assert.equal(plan.ideaKind, "castle");
  assert.equal(plan.tactical, false);
  assert.ok(
    plan.persistentAnnotations.arrows.some(
      (arrow) => arrow.move === "h1f1" && arrow.role === "defense",
    ),
  );
  assert.ok(
    plan.persistentAnnotations.highlights.some(
      (highlight) => highlight.square === "g1",
    ),
  );
});

test("eine Entwicklungsregel zeigt nur den tatsächlich gespielten Entwicklungszug", () => {
  const plan = buildCoachVisualPlan({
    fen: new Chess().fen(),
    pv: ["g1f3", "g8f6"],
  });

  assert.equal(plan.ideaKind, "development");
  assert.equal(plan.piece, "n");
  assert.deepEqual(plan.persistentAnnotations.arrows, [{
    move: "g1f3",
    rank: 1,
    impact: 1,
    role: "primary",
  }]);
  assert.deepEqual(plan.persistentAnnotations.highlights, [
    { square: "g1", role: "origin" },
    { square: "f3", role: "destination" },
  ]);
});

test("offene Linien werden als vollständiger Wirkungsraum markiert", () => {
  const plan = buildCoachVisualPlan({
    fen: "4k3/8/8/8/8/8/R7/4K3 w - - 0 1",
    pv: ["a2d2", "e8f7"],
  });

  assert.equal(plan.ideaKind, "open-file");
  assert.deepEqual(
    plan.persistentAnnotations.highlights
      .filter((entry) => entry.role === "concept" && entry.square[0] === "d")
      .map((entry) => entry.square)
      .sort(),
    ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8"],
  );
});

test("Freibauern markieren ihren legalen Weg bis zur Umwandlungsreihe", () => {
  const plan = buildCoachVisualPlan({
    fen: "7k/8/8/4P3/8/8/8/7K w - - 0 1",
    pv: ["e5e6", "h8g7"],
  });

  assert.equal(plan.ideaKind, "passed-pawn");
  assert.ok(
    plan.persistentAnnotations.arrows.some(
      (arrow) => arrow.move === "e6e8" && arrow.role === "concept",
    ),
  );
  assert.deepEqual(
    plan.persistentAnnotations.highlights
      .filter((entry) => entry.role === "concept")
      .map((entry) => entry.square),
    ["e7", "e8"],
  );
});

test("ein direkter Einzelangriff markiert genau das angegriffene Ziel", () => {
  const plan = buildCoachVisualPlan({
    fen: "k7/7r/8/8/8/8/2B5/4K3 w - - 0 1",
    pv: ["c2g6", "a8b8"],
  });

  assert.equal(plan.ideaKind, "pressure");
  assert.ok(
    plan.persistentAnnotations.arrows.some(
      (arrow) => arrow.move === "g6h7" && arrow.role === "threat",
    ),
  );
  assert.ok(
    plan.persistentAnnotations.highlights.some(
      (highlight) => highlight.square === "h7" && highlight.role === "target",
    ),
  );
});

test("Absicherung und Königsdruck erhalten unterschiedliche visuelle Rollen", () => {
  const defense = buildCoachVisualPlan({
    fen: "4k3/8/8/3N4/8/8/2B5/4K3 w - - 0 1",
    pv: ["c2b3", "e8f7"],
  });
  const kingPressure = buildCoachVisualPlan({
    fen: "6k1/8/8/2N5/8/8/8/7K w - - 0 1",
    pv: ["c5e6", "g8f7"],
  });

  assert.equal(defense.ideaKind, "defense");
  assert.ok(
    defense.persistentAnnotations.arrows.some(
      (arrow) => arrow.move === "b3d5" && arrow.role === "defense",
    ),
  );
  assert.equal(kingPressure.ideaKind, "king-pressure");
  assert.ok(
    kingPressure.persistentAnnotations.highlights.filter(
      (highlight) => highlight.role === "danger",
    ).length >= 2,
  );
});

test("Fesselung und Abzugsschach zeigen die tatsächlich wirkenden Linien", () => {
  const pin = buildCoachVisualPlan({
    fen: "4k3/8/2n5/8/2B5/8/8/4K3 w - - 0 1",
    pv: ["c4b5"],
  });
  const discoveredCheck = buildCoachVisualPlan({
    fen: "4k3/8/8/8/8/8/4N3/4R1K1 w - - 0 1",
    pv: ["e2c3"],
  });

  assert.equal(pin.motif, "Fesselung");
  assert.ok(
    pin.persistentAnnotations.arrows.some((arrow) => arrow.move === "b5c6"),
  );
  assert.ok(
    pin.persistentAnnotations.arrows.some((arrow) => arrow.move === "c6e8"),
  );
  assert.equal(discoveredCheck.motif, "Abzugsschach");
  assert.ok(
    discoveredCheck.persistentAnnotations.arrows.some(
      (arrow) => arrow.move === "e1e8" && arrow.role === "danger",
    ),
  );
});

test("Zugbewertungen unterscheiden Gleichwertigkeit und Fehlerzeichen", () => {
  assert.deepEqual(
    moveQualityPresentation({
      quality: "excellent",
      playedUci: "d2d4",
      bestUci: "e2e4",
      lossCp: 10,
    }),
    { symbol: "!", label: "Ebenfalls bester Zug", tone: "excellent" },
  );
  assert.deepEqual(
    moveQualityPresentation({ quality: "inaccuracy", lossCp: 55 }),
    { symbol: "?!", label: "Ungenauigkeit", tone: "inaccuracy" },
  );
  assert.deepEqual(
    moveQualityPresentation({ quality: "mistake", lossCp: 180 }),
    { symbol: "?", label: "Klarer Fehler", tone: "mistake" },
  );
  assert.equal(
    moveQualityPresentation({ quality: "blunder", lossCp: 320 }).symbol,
    "??",
  );
});
