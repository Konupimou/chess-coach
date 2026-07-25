import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { MoveTreeNode, addMoveToTree } from "../moveTree.js";
import {
  createAccountState,
  deserializeMoveTree,
  findNodeByPath,
  loadAccountState,
  mergeAccountStates,
  nodePathFromRoot,
  removeSavedGame,
  saveAccountState,
  serializeMoveTree,
  storageKeyForIdentity,
  upsertSavedGame,
} from "../gameStorage.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("Variantenbaum kann ohne Parent-Zyklen gespeichert und wiederhergestellt werden", () => {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen(), analysis: { whiteCp: 20 } });
  const e4 = addMoveToTree(root, game.move("e4"), game.fen());
  game.load(root.fen);
  const d4 = addMoveToTree(root, game.move("d4"), game.fen());
  d4.analysis = { whiteCp: 10, depth: 12 };

  const serialized = serializeMoveTree(root);
  assert.doesNotThrow(() => JSON.stringify(serialized));
  const restored = deserializeMoveTree(serialized);
  assert.equal(restored.mainline.move.san, e4.move.san);
  assert.equal(restored.variations[0].move.san, "d4");
  assert.equal(restored.variations[0].parent, restored);
  assert.deepEqual(restored.variations[0].analysis, { whiteCp: 10, depth: 12 });
});

test("gespeicherter Knotenpfad unterscheidet Transpositionen mit identischer FEN", () => {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen() });
  const nf3 = addMoveToTree(root, game.move("Nf3"), game.fen());
  const nf6 = addMoveToTree(nf3, game.move("Nf6"), game.fen());
  const nc3 = addMoveToTree(nf6, game.move("Nc3"), game.fen());
  const mainEnd = addMoveToTree(nc3, game.move("Nc6"), game.fen());

  game.load(root.fen);
  const altNc3 = addMoveToTree(root, game.move("Nc3"), game.fen());
  const altNc6 = addMoveToTree(altNc3, game.move("Nc6"), game.fen());
  const altNf3 = addMoveToTree(altNc6, game.move("Nf3"), game.fen());
  const variationEnd = addMoveToTree(altNf3, game.move("Nf6"), game.fen());
  assert.equal(mainEnd.fen, variationEnd.fen);

  const path = nodePathFromRoot(variationEnd);
  const restored = deserializeMoveTree(serializeMoveTree(root));
  const restoredEnd = findNodeByPath(restored, path);
  assert.equal(restoredEnd.parent.parent.parent, restored.variations[0]);
  assert.equal(restoredEnd.move.san, "Nf6");
});

test("Account-Daten werden pro Identität gespeichert und Spiele aktualisiert", () => {
  const storage = memoryStorage();
  const profile = { name: "Paul", email: "Paul@example.com", source: "sites" };
  const key = storageKeyForIdentity(profile);
  assert.match(key, /paul%40example\.com/);
  let state = createAccountState(profile, "2026-07-25T00:00:00.000Z");
  state = upsertSavedGame(state, {
    id: "game-1",
    title: "Testpartie",
    tree: { version: 1, root: { fen: "fen" } },
    plyCount: 2,
    metadata: {
      playerColor: "w",
      playedAt: "2026-07-25",
      opponent: "Lena",
      timeFormat: "rapid",
      playerRating: "1510",
      rated: true,
    },
  });
  assert.equal(saveAccountState(storage, key, state), true);
  const loaded = loadAccountState(storage, key, profile);
  assert.equal(loaded.profile.email, "paul@example.com");
  assert.equal(loaded.games[0].id, "game-1");
  assert.deepEqual(loaded.games[0].metadata, {
    playerColor: "w",
    playedAt: "2026-07-25",
    opponent: "Lena",
    opening: "",
    timeFormat: "rapid",
    timeControl: "",
    platform: "",
    event: "",
    playerRating: 1510,
    opponentRating: null,
    rated: true,
    notes: "",
  });
});

test("Schema 2 liest alte Schema-1-Partien, ohne sie automatisch umzuschreiben", () => {
  const storage = memoryStorage();
  const profile = { name: "Paul", source: "local" };
  const currentKey = storageKeyForIdentity(profile);
  const legacyKey = currentKey.replace("chess-coach.account.v2", "chess-coach.account.v1");
  storage.setItem(legacyKey, JSON.stringify({
    version: 1,
    profile,
    games: [{
      id: "legacy",
      title: "Alte Partie",
      tree: { version: 1, root: { fen: "fen" } },
      review: { final: true, feedback: "Alt" },
    }],
  }));

  const loaded = loadAccountState(storage, currentKey, profile);
  assert.equal(loaded.version, 2);
  assert.equal(loaded.games[0].id, "legacy");
  assert.equal(storage.getItem(currentKey), null);
});

test("gespeicherte Reviews teilen keine veränderliche Referenz mit dem Live-Bericht", () => {
  const report = { final: true, feedback: "Vor dem Coach" };
  const state = upsertSavedGame(createAccountState(), {
    id: "review-copy",
    title: "Review",
    tree: { version: 1, root: { fen: "fen" } },
    review: report,
  });

  report.feedback = "Späteres Coach-Feedback";
  assert.equal(state.games[0].review.feedback, "Vor dem Coach");
});

test("Account-Zustände aus mehreren Tabs behalten unterschiedliche Partien", () => {
  const profile = { name: "Paul", source: "local" };
  const first = upsertSavedGame(createAccountState(profile), {
    id: "game-a",
    title: "A",
    updatedAt: "2026-07-25T10:00:00.000Z",
    tree: { version: 1, root: { fen: "fen-a" } },
  });
  const second = upsertSavedGame(createAccountState(profile), {
    id: "game-b",
    title: "B",
    updatedAt: "2026-07-25T11:00:00.000Z",
    tree: { version: 1, root: { fen: "fen-b" } },
  });
  const merged = mergeAccountStates(first, second);
  assert.deepEqual(merged.games.map((game) => game.id), ["game-b", "game-a"]);
});

test("Cross-Tab-Löschung kann eine veraltete Partie nicht wiederbeleben", () => {
  const profile = { name: "Paul", source: "local" };
  const shared = upsertSavedGame(createAccountState(profile), {
    id: "game-a",
    title: "A",
    updatedAt: "2026-07-25T10:00:00.000Z",
    tree: { version: 1, root: { fen: "fen-a" } },
  });
  const staleTab = structuredClone(shared);
  const deletingTab = removeSavedGame(
    structuredClone(shared),
    "game-a",
    "2026-07-25T11:00:00.000Z",
  );

  const merged = mergeAccountStates(staleTab, deletingTab);
  assert.equal(merged.games.length, 0);
  assert.deepEqual(merged.deletedGames, [{
    id: "game-a",
    deletedAt: "2026-07-25T11:00:00.000Z",
  }]);
  assert.throws(
    () => upsertSavedGame(merged, {
      ...shared.games[0],
      updatedAt: "2026-07-25T12:00:00.000Z",
    }),
    /anderen Tab gelöscht/,
  );

  const storage = memoryStorage();
  assert.equal(saveAccountState(storage, "account", deletingTab), true);
  const restored = loadAccountState(storage, "account", profile);
  assert.equal(restored.deletedGames[0].id, "game-a");
});
