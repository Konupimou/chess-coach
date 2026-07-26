import test from "node:test";
import assert from "node:assert/strict";
import {
  MOVE_ARROW_STYLES,
  arrowGeometry,
  normalizeArrowMoves,
  parseUciMove,
  selectImpactArrowMoves,
  squareCenter,
} from "../moveArrows.js";

test("alle Vorschlagspfeile verwenden dieselbe Farbe", () => {
  assert.equal(new Set(MOVE_ARROW_STYLES.map((style) => style.color)).size, 1);
});

test("Impact-Pfeile zeigen nur den klaren Topzug oder ähnlich starke Alternativen", () => {
  const line = (rank, move, pawns) => [
    rank,
    { fen: "start w - - 0 1", pv: [move], whiteScore: { unit: "cp", value: pawns * 100, pawns } },
  ];
  assert.deepEqual(
    selectImpactArrowMoves([
      line(1, "e2e4", 0.8),
      line(2, "d2d4", 0.2),
      line(3, "g1f3", 0.1),
    ]),
    [{ rank: 1, move: "e2e4", impact: 1 }],
  );
  const close = selectImpactArrowMoves([
    line(1, "e2e4", 0.8),
    line(2, "d2d4", 0.62),
    line(3, "g1f3", 0.1),
  ]);
  assert.equal(close.length, 3);
  assert.ok(close[0].impact > close[1].impact);
  assert.ok(close[1].impact > close[2].impact);
});

test("UCI-Züge werden einschließlich Umwandlung validiert", () => {
  assert.deepEqual(parseUciMove("e7e8q"), {
    from: "e7",
    to: "e8",
    promotion: "q",
    uci: "e7e8q",
  });
  assert.equal(parseUciMove("e2e2"), null);
  assert.equal(parseUciMove("e9e4"), null);
  assert.equal(parseUciMove("e2-e4"), null);
});

test("Feldmittelpunkte folgen der Brettorientierung", () => {
  assert.deepEqual(squareCenter("a1", "white"), { x: 6.25, y: 93.75 });
  assert.deepEqual(squareCenter("h8", "white"), { x: 93.75, y: 6.25 });
  assert.deepEqual(squareCenter("a1", "black"), { x: 93.75, y: 6.25 });
  assert.deepEqual(squareCenter("h8", "black"), { x: 6.25, y: 93.75 });
  assert.equal(squareCenter("e4", "sideways"), null);
});

test("Pfeile enden vor der Mitte des Zielfelds", () => {
  assert.deepEqual(arrowGeometry("e2e4", "white"), {
    x1: 56.25,
    y1: 80.1,
    x2: 56.25,
    y2: 57.9,
  });
  assert.deepEqual(arrowGeometry("e2e4", "black"), {
    x1: 43.75,
    y1: 19.9,
    x2: 43.75,
    y2: 42.1,
  });
});

test("Pfeilliste entfernt Dubletten, sortiert und begrenzt", () => {
  assert.deepEqual(
    normalizeArrowMoves([
      { rank: 3, move: "g1f3" },
      { rank: 1, move: "e2e4" },
      { rank: 2, move: "g1f3" },
      { rank: 4, move: "ungültig" },
    ]),
    [
      { from: "e2", to: "e4", promotion: null, uci: "e2e4", rank: 1 },
      { from: "g1", to: "f3", promotion: null, uci: "g1f3", rank: 2 },
    ],
  );
  assert.deepEqual(
    normalizeArrowMoves(["e2e4", "d2d4"], 1),
    [{ from: "e2", to: "e4", promotion: null, uci: "e2e4", rank: 1 }],
  );
});
