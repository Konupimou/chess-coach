import test from "node:test";
import assert from "node:assert/strict";

import { knowledgeFeatureIdsFromPositionEvidence } from "../coachExplanation.js";
import { buildPositionEvidence } from "../positionEvidence.js";

function evidence(fenBefore, playedUci, variations) {
  return buildPositionEvidence({
    fenBefore,
    playedUci,
    candidateLines: variations.map((pv, index) => ({
      rank: index + 1,
      pv,
      evaluation: { unit: "cp", value: index === 0 ? 80 : 20 },
    })),
  });
}

function features(...args) {
  const result = evidence(...args);
  assert.equal(result.valid, true);
  assert.deepEqual(result.rejectedLines, []);
  return knowledgeFeatureIdsFromPositionEvidence(result);
}

test("Bauernendspiel, Bauernrennen und aktive Königszüge werden aus Brett und legaler PV belegt", () => {
  const ids = features(
    "8/8/7p/P7/4k3/8/8/4K3 w - - 0 1",
    "e1e2",
    [["e1e2", "h6h5", "a5a6"], ["e1f2", "h6h5"]],
  );

  assert.ok(ids.includes("endgame.pawn_endgame"));
  assert.ok(ids.includes("endgame.pawn_race"));
  assert.ok(ids.includes("endgame.king_can_activate"));
});

test("Flügelmehrheit und Grundreihenmotiv bleiben getrennte, belegte Fakten", () => {
  const ids = features(
    "4r1k1/ppp2pp1/8/8/8/8/PP3PPP/6K1 w - - 0 1",
    "h2h3",
    [["h2h3", "e8e1", "g1h2"]],
  );

  assert.ok(ids.includes("pawn.kingside_majority"));
  assert.ok(ids.includes("king.back_rank_weakness"));
  assert.ok(ids.includes("tactic.back_rank_mate"));
});

test("Turmendspiel und Turm hinter Freibauern brauchen passende Material- und Felddaten", () => {
  const ids = features(
    "4k2r/8/7p/P7/8/8/8/R3K3 w - - 0 30",
    "a1a3",
    [["a1a3", "h8h7"], ["a1a2", "h8h7"]],
  );

  assert.ok(ids.includes("endgame.rook_endgame"));
  assert.ok(ids.includes("endgame.rook_and_passed_pawn"));
  assert.ok(ids.includes("endgame.rook_can_reach_behind"));
});

test("Figurentausch und überlasteter Verteidiger stammen aus legal geprüften Varianten", () => {
  const exchangeIds = features(
    "4k3/8/4p3/3n4/2B5/8/8/3QK3 w - - 0 25",
    "c4d5",
    [["c4d5", "e6d5"], ["d1h5", "e8e7"]],
  );
  assert.ok(exchangeIds.includes("exchange.piece_trade_available"));

  const overloadIds = features(
    "3q2k1/8/1b3b2/8/8/8/8/1R3R1K w - - 0 1",
    "b1b6",
    [["b1b6", "d8b6", "f1f6"]],
  );
  assert.ok(overloadIds.includes("tactic.overloaded_defender"));
});

test("Qualitätsopfer wird nur bei konkreter Turm-gegen-Leichtfigur-Folge markiert", () => {
  const ids = features(
    "4k3/8/5p2/4b3/8/8/1Q6/4R1K1 w - - 0 25",
    "e1e5",
    [["e1e5", "f6e5", "b2e5"], ["b2b8", "e8f7"]],
  );

  assert.ok(ids.includes("exchange.quality_sacrifice_in_best_line"));
  assert.ok(ids.includes("exchange.unfavorable"));
});

test("ohne Brett- oder Variantenbeleg werden Spezialmotive nicht erfunden", () => {
  const ids = features(
    "4k3/8/8/8/8/8/4P3/4K3 w - - 0 30",
    "e2e3",
    [["e2e3", "e8f7"], ["e2e4", "e8f7"]],
  );

  assert.equal(ids.includes("tactic.deflection"), false);
  assert.equal(ids.includes("tactic.overloaded_defender"), false);
  assert.equal(ids.includes("exchange.quality_sacrifice_in_best_line"), false);
  assert.equal(ids.includes("endgame.rook_and_passed_pawn"), false);
});

test("ein angegriffener Bauer allein wird nicht als schwere gegnerische Drohung überhöht", () => {
  const ids = features(
    "4k3/8/8/1b6/8/8/4P3/7K w - - 0 30",
    "h1g1",
    [["h1g1", "e8f7"], ["h1h2", "e8f7"]],
  );

  assert.equal(ids.includes("opponent.threat"), false);
  assert.equal(ids.includes("defence.active_resource"), false);
});
