import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { MoveTreeNode, addMoveToTree } from "../moveTree.js";
import { moveTreeToPgn } from "../moveTreeToPgn.js";

function addSan(game, parent, san) {
  const move = game.move(san);
  assert.ok(move, `Zug ${san} muss legal sein`);
  return addMoveToTree(parent, move, game.fen());
}

test("leerer Baum exportiert ein unbekanntes Ergebnis", () => {
  assert.equal(moveTreeToPgn(null), "*");
  assert.equal(moveTreeToPgn(new MoveTreeNode()), "*");
});

test("Hauptlinie hat kanonische einfache Leerzeichen", () => {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen() });
  let node = addSan(game, root, "e4");
  node = addSan(game, node, "e5");
  node = addSan(game, node, "Nf3");
  addSan(game, node, "Nc6");

  assert.equal(moveTreeToPgn(root), "1. e4 e5 2. Nf3 Nc6 *");
  assert.doesNotMatch(moveTreeToPgn(root), / {2,}/);
});

test("Varianten werden genau einmal an der richtigen Stelle exportiert", () => {
  const mainGame = new Chess();
  const root = new MoveTreeNode({ fen: mainGame.fen() });
  const e4 = addSan(mainGame, root, "e4");
  const e5 = addSan(mainGame, e4, "e5");
  const nf3 = addSan(mainGame, e5, "Nf3");
  addSan(mainGame, nf3, "Nc6");

  const d4Game = new Chess();
  const d4 = addSan(d4Game, root, "d4");
  addSan(d4Game, d4, "d5");

  const c4Game = new Chess();
  addSan(c4Game, root, "c4");

  const sicilian = new Chess(e4.fen);
  const c5 = addSan(sicilian, e4, "c5");
  addSan(sicilian, c5, "Nf3");
  sicilian.load(c5.fen);
  addSan(sicilian, c5, "Nc3");

  const pgn = moveTreeToPgn(root);
  assert.equal(
    pgn,
    "1. e4 (1. d4 d5) (1. c4) e5 (1... c5 2. Nf3 (2. Nc3)) 2. Nf3 Nc6 *",
  );
  assert.doesNotMatch(pgn, / {2,}/);
});

test("Schachmatt wird als Partieergebnis exportiert", () => {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen() });
  let node = root;
  for (const san of ["f3", "e5", "g4", "Qh4#"]) {
    node = addSan(game, node, san);
  }
  assert.equal(moveTreeToPgn(root), "1. f3 e5 2. g4 Qh4# 0-1");
});

test("eine FEN mit Schwarz am Zug behält Zugnummer und Auslassungspunkte", () => {
  const game = new Chess("8/8/8/8/8/3k4/8/3K4 b - - 0 23");
  const root = new MoveTreeNode({ fen: game.fen() });
  addSan(game, root, "Kc3");
  assert.equal(moveTreeToPgn(root), "23... Kc3 *");
});
