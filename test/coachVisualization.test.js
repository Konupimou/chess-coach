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
});

test("eine konkrete Springergabel wird benannt und am Brett markiert", () => {
  const plan = buildCoachVisualPlan({
    fen: "k7/8/3q1r2/8/8/2N5/8/7K w - - 0 1",
    pv: ["c3e4"],
  });

  assert.ok(plan);
  assert.equal(plan.tactical, true);
  assert.equal(plan.motif, "Gabel");
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
});

test("eine spätere taktische Pointe verlängert die Variante nur bis zur Auflösung", () => {
  const plan = buildCoachVisualPlan({
    fen: new Chess().fen(),
    pv: ["e2e4", "d7d5", "e4d5", "d8d5", "b1c3", "d5d8", "g1f3"],
  });

  assert.ok(plan);
  assert.equal(plan.motif, "Abtauschfolge");
  assert.ok(plan.plyCount > 2);
  assert.ok(plan.plyCount < 7);
  assert.equal(plan.san.length, plan.plyCount);
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
