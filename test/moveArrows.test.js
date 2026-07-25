import test from "node:test";
import assert from "node:assert/strict";
import {
  MOVE_ARROW_STYLES,
  arrowGeometry,
  normalizeArrowMoves,
  parseUciMove,
  squareCenter,
} from "../moveArrows.js";

test("alle Vorschlagspfeile verwenden dieselbe Farbe", () => {
  assert.equal(new Set(MOVE_ARROW_STYLES.map((style) => style.color)).size, 1);
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
    y1: 81.25,
    x2: 56.25,
    y2: 59.65,
  });
  assert.deepEqual(arrowGeometry("e2e4", "black"), {
    x1: 43.75,
    y1: 18.75,
    x2: 43.75,
    y2: 40.35,
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
