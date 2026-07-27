import test from "node:test";
import assert from "node:assert/strict";
import {
  MOVE_ARROW_STYLES,
  MoveArrowOverlay,
  arrowGeometry,
  arrowHeadGeometry,
  normalizeArrowMoves,
  normalizeSquareHighlights,
  parseUciMove,
  selectImpactArrowMoves,
  squareBounds,
  squareCenter,
} from "../moveArrows.js";

function fakeSvgElement(tagName = "div") {
  return {
    tagName,
    children: [],
    dataset: {},
    hidden: false,
    style: {},
    attributes: new Map(),
    classList: { add() {} },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    remove() {},
  };
}

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

test("Pfeilspitzen werden als symmetrische, eigenständige Dreiecke berechnet", () => {
  const geometry = arrowGeometry("e2e4", "white");
  const head = arrowHeadGeometry(geometry, 1.72);
  assert.deepEqual(head.tip, { x: geometry.x2, y: geometry.y2 });
  assert.equal(head.left.y, head.right.y);
  assert.equal((head.left.x + head.right.x) / 2, geometry.x2);
  assert.ok(head.left.x > head.right.x);
  assert.ok(head.shaftEnd.y > geometry.y2);
});

test("Pfeil-Overlay rendert einen legalen Zug ohne die Analysekarte zu unterbrechen", () => {
  const documentRef = {
    createElementNS(_namespace, tagName) {
      return fakeSvgElement(tagName);
    },
  };
  const hostEl = {
    ownerDocument: documentRef,
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
    getBoundingClientRect() {
      return { left: 0, top: 0 };
    },
  };
  const boardSurface = {
    clientWidth: 800,
    clientHeight: 800,
    clientLeft: 0,
    clientTop: 0,
    getBoundingClientRect() {
      return { left: 0, top: 0 };
    },
  };
  const boardEl = {
    querySelector(selector) {
      return selector === ".board-b72b1" ? boardSurface : null;
    },
  };

  const overlay = new MoveArrowOverlay({ hostEl, boardEl });
  assert.doesNotThrow(() => overlay.setMoves([{ move: "e2e4", rank: 1 }]));
  assert.equal(overlay.svg.hidden, false);
  assert.equal(overlay.svg.children.filter((child) => child.tagName === "line").length, 2);
  assert.equal(overlay.svg.children.filter((child) => child.tagName === "path").length, 1);
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

test("Coach-Markierungen validieren Felder, Rollen und Brettorientierung", () => {
  assert.deepEqual(
    normalizeSquareHighlights([
      { square: "e4", role: "destination" },
      { square: "E4", role: "danger" },
      { square: "d6", role: "target" },
      { square: "z9", role: "target" },
    ]),
    [
      { square: "e4", role: "danger" },
      { square: "d6", role: "target" },
    ],
  );
  assert.deepEqual(
    squareBounds("a8", "white"),
    { x: 0, y: 0, width: 12.5, height: 12.5 },
  );
  assert.deepEqual(
    squareBounds("a8", "black"),
    { x: 87.5, y: 87.5, width: 12.5, height: 12.5 },
  );
});
