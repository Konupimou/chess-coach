import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Chess } from "chess.js";
import { MoveTreeNode, addMoveToTree } from "../moveTree.js";
import { createOpeningBook } from "../openingRecognition.js";
import {
  createGameSaveDraft,
  inferOpeningFromPath,
} from "../gameMetadata.js";

const openingBook = createOpeningBook(JSON.parse(
  await readFile(new URL("../public/data/openings/openings.runtime.json", import.meta.url), "utf8"),
));

function pathForMoves(moves) {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen() });
  const path = [root];
  let node = root;
  for (const san of moves) {
    node = addMoveToTree(node, game.move(san), game.fen());
    path.push(node);
  }
  return path;
}

test("häufige Eröffnungen werden aus der gespielten Zugfolge vorgeschlagen", () => {
  assert.equal(
    inferOpeningFromPath(pathForMoves(["e4", "e5", "Nf3", "Nc6", "Bb5"]), openingBook),
    "Spanische Partie",
  );
  assert.equal(
    inferOpeningFromPath(pathForMoves(["d4", "d5", "c4"]), openingBook),
    "Damengambit",
  );
  assert.equal(
    inferOpeningFromPath(pathForMoves(["c4"]), openingBook),
    "Englische Eröffnung",
  );
});

test("Speicherentwurf übernimmt vorhandene Metadaten und setzt ein lokales Datum", () => {
  const draft = createGameSaveDraft({
    title: "Testpartie",
    result: "1-0",
    metadata: {
      playerColor: "w",
      playedAt: "2026-07-24",
      opponentType: "engine",
      engineLevel: "hard",
      timeFormat: "rapid",
      playerRating: 1500,
      rated: true,
    },
  });
  assert.equal(draft.playerColor, "w");
  assert.equal(draft.opponentType, "engine");
  assert.equal(draft.engineLevel, "hard");
  assert.equal(draft.timeFormat, "rapid");
  assert.equal(draft.playerRating, "1500");
  assert.equal(draft.rated, "yes");

  const fresh = createGameSaveDraft(null, new Date(2026, 6, 25, 23, 30));
  assert.equal(fresh.playedAt, "2026-07-25");
});
