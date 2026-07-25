import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { MoveTreeNode, addMoveToTree, findNodeByFen } from "../moveTree.js";

test("addMoveToTree erstellt Hauptlinie, dedupliziert und ergänzt Varianten", () => {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen() });

  const e4 = game.move("e4");
  const e4Node = addMoveToTree(root, e4, game.fen());
  assert.equal(root.mainline, e4Node);
  assert.equal(e4Node.parent, root);
  assert.equal(addMoveToTree(root, e4, e4Node.fen), e4Node);

  game.reset();
  const d4 = game.move("d4");
  const d4Node = addMoveToTree(root, d4, game.fen());
  assert.deepEqual(root.variations, [d4Node]);
  assert.equal(addMoveToTree(root, d4, d4Node.fen), d4Node);
});

test("findNodeByFen findet Hauptlinie und tiefe Variation", () => {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen() });
  const e4 = addMoveToTree(root, game.move("e4"), game.fen());
  const e5 = addMoveToTree(e4, game.move("e5"), game.fen());

  game.load(e4.fen);
  const c5 = addMoveToTree(e4, game.move("c5"), game.fen());
  const nf3 = addMoveToTree(c5, game.move("Nf3"), game.fen());

  assert.equal(findNodeByFen(root, root.fen), root);
  assert.equal(findNodeByFen(root, e5.fen), e5);
  assert.equal(findNodeByFen(root, nf3.fen), nf3);
  assert.equal(findNodeByFen(root, "nicht vorhanden"), null);
});
