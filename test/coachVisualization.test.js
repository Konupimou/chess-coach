import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  buildCoachVisualPlan,
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
  assert.equal(plan.plyCount, 2);
  assert.deepEqual(plan.san, ["e4", "e5"]);
  assert.match(plan.headline, /Zentrum/);
  assert.deepEqual(
    plan.persistentAnnotations.highlights
      .filter((entry) => entry.role === "concept")
      .map((entry) => entry.square)
      .sort(),
    ["d4", "d5", "e4", "e5"],
  );
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
  assert.equal(plan.plyCount, 2);
  assert.deepEqual(plan.san, ["d5", "c4"]);
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
  assert.equal(
    moveQualityPresentation({ quality: "blunder", lossCp: 320 }).symbol,
    "??",
  );
});
