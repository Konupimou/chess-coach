import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { MoveListView } from "../MoveListView.js";
import { MoveTreeNode, addMoveToTree } from "../moveTree.js";

function createView() {
  const view = Object.create(MoveListView.prototype);
  view.collapsed = new Set();
  view.container = { innerHTML: "" };
  view._lastRoot = null;
  view._lastCurrent = null;
  return view;
}

test("eine ausgewählte Variation wird hervorgehoben", () => {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen() });
  addMoveToTree(root, game.move("e4"), game.fen());

  game.reset();
  const d4 = addMoveToTree(root, game.move("d4"), game.fen());
  const view = createView();
  view.render(root, d4);

  assert.match(
    view.container.innerHTML,
    /class="variant-move current-move"[^>]*>d4<\/span>/,
  );
});

test("SAN und FEN werden vor dem Rendern escaped", () => {
  const root = new MoveTreeNode({ fen: "8/8/8/8/8/8/8/8 w - - 0 1" });
  root.mainline = new MoveTreeNode({
    parent: root,
    fen: '"><script>alert(1)</script>',
    move: { color: "w", san: "<img src=x onerror=alert(1)>" },
  });
  const view = createView();
  view.render(root, root.mainline);

  assert.doesNotMatch(view.container.innerHTML, /<script>|<img src=x/);
  assert.match(view.container.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(view.container.innerHTML, /&quot;&gt;&lt;script&gt;/);
});

test("eine schwarze Ausgangsstellung beginnt in der Schwarz-Spalte", () => {
  const game = new Chess("8/8/8/8/8/3k4/8/3K4 b - - 0 23");
  const root = new MoveTreeNode({ fen: game.fen() });
  const black = addMoveToTree(root, game.move("Kc3"), game.fen());
  const view = createView();
  view.render(root, black);

  assert.match(
    view.container.innerHTML,
    /<tr class="main-row" data-movenum="23"><td>23<\/td><td><\/td><td class="current-move"/,
  );
});
